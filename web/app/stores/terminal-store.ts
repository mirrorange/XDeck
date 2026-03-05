import { create } from "zustand";
import { getRpcClient } from "~/lib/rpc-client";

// -- Types -------------------------------------------------------

export interface PtySessionInfo {
  session_id: string;
  name: string;
  session_type: "terminal" | "process_daemon";
  process_id?: string;
  command: string;
  cols: number;
  rows: number;
  client_count: number;
  pid?: number;
  created_at: string;
}

export interface TerminalTab {
  id: string;
  sessionId: string;
  title: string;
}

function resolveActiveTabId(activeTabId: string | null, tabs: TerminalTab[]): string | null {
  if (activeTabId && tabs.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return tabs[tabs.length - 1]?.id ?? null;
}

function removeSessionFromState(
  state: Pick<TerminalState, "sessions" | "tabs" | "activeTabId">,
  sessionId: string
) {
  const sessions = state.sessions.filter((session) => session.session_id !== sessionId);
  const tabs = state.tabs.filter((tab) => tab.sessionId !== sessionId);
  return {
    sessions,
    tabs,
    activeTabId: resolveActiveTabId(state.activeTabId, tabs),
  };
}

interface TerminalState {
  /** Remote session list from server. */
  sessions: PtySessionInfo[];
  /** Locally opened terminal tabs. */
  tabs: TerminalTab[];
  /** Currently active tab id. */
  activeTabId: string | null;
  isLoading: boolean;

  fetchSessions: () => Promise<void>;
  createSession: (opts?: { name?: string; cols?: number; rows?: number }) => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
  openTab: (sessionId: string, title: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  subscribeToEvents: () => () => void;
}

let tabIdCounter = 0;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  tabs: [],
  activeTabId: null,
  isLoading: false,

  fetchSessions: async () => {
    set({ isLoading: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ sessions: PtySessionInfo[] }>("pty.list");
      set({ sessions: result.sessions, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch PTY sessions:", err);
      set({ isLoading: false });
    }
  },

  createSession: async (opts) => {
    const rpc = getRpcClient();
    const result = await rpc.call<PtySessionInfo>("pty.create", {
      name: opts?.name,
      cols: opts?.cols ?? 80,
      rows: opts?.rows ?? 24,
    });

    set((state) => ({
      sessions: [...state.sessions, result],
    }));

    // Also open a tab for the new session
    const tabId = `tab-${++tabIdCounter}`;
    set((state) => ({
      tabs: [
        ...state.tabs,
        { id: tabId, sessionId: result.session_id, title: result.name },
      ],
      activeTabId: tabId,
    }));

    return result.session_id;
  },

  closeSession: async (sessionId) => {
    const rpc = getRpcClient();
    await rpc.call("pty.close", { session_id: sessionId });
    set((state) => removeSessionFromState(state, sessionId));
  },

  openTab: (sessionId, title) => {
    const state = get();
    // If tab for this session already exists, just activate it
    const existing = state.tabs.find((t) => t.sessionId === sessionId);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const tabId = `tab-${++tabIdCounter}`;
    set((state) => ({
      tabs: [...state.tabs, { id: tabId, sessionId, title }],
      activeTabId: tabId,
    }));
  },

  closeTab: (tabId) => {
    set((state) => {
      const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
      const tabs = state.tabs.filter((t) => t.id !== tabId);
      let activeTabId = state.activeTabId;
      if (state.activeTabId === tabId) {
        // Activate the next or previous tab
        const newIndex = Math.min(tabIndex, tabs.length - 1);
        activeTabId = tabs[newIndex]?.id ?? null;
      }
      return { tabs, activeTabId };
    });
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  renameTab: (tabId, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    }));
  },

  subscribeToEvents: () => {
    const rpc = getRpcClient();

    const unsubCreated = rpc.on("event.pty.session_created", (params) => {
      const session = params as PtySessionInfo;
      set((state) => {
        const sessionExists = state.sessions.some(
          (existing) => existing.session_id === session.session_id
        );
        const sessions = sessionExists
          ? state.sessions.map((existing) =>
              existing.session_id === session.session_id ? session : existing
            )
          : [...state.sessions, session];

        let tabs = state.tabs;
        let activeTabId = state.activeTabId;

        if (
          session.session_type === "terminal" &&
          !tabs.some((tab) => tab.sessionId === session.session_id)
        ) {
          const tabId = `tab-${++tabIdCounter}`;
          tabs = [...tabs, { id: tabId, sessionId: session.session_id, title: session.name }];
          if (!activeTabId) {
            activeTabId = tabId;
          }
        }

        return { sessions, tabs, activeTabId };
      });
    });

    const unsubClosed = rpc.on("event.pty.session_closed", (params) => {
      const { session_id } = params as { session_id: string };
      set((state) => removeSessionFromState(state, session_id));
    });

    const unsubClientCount = rpc.on("event.pty.session_client_count", (params) => {
      const { session_id, client_count } = params as {
        session_id: string;
        client_count: number;
      };
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.session_id === session_id ? { ...s, client_count } : s
        ),
      }));
    });

    return () => {
      unsubCreated();
      unsubClosed();
      unsubClientCount();
    };
  },
}));
