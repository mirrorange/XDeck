import { useCallback, useEffect, useState } from "react";
import { Loader2, Terminal } from "lucide-react";

import { TerminalTabBar } from "./TerminalTabBar";
import { TerminalInstance } from "./TerminalInstance";
import { useTerminalStore } from "~/stores/terminal-store";

export function TerminalPage() {
  const {
    tabs,
    activeTabId,
    sessions,
    isLoading,
    fetchSessions,
    createSession,
    closeSession,
    closeTab,
    setActiveTab,
    openTab,
    subscribeToEvents,
  } = useTerminalStore();

  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    void fetchSessions();
    const unsubscribe = subscribeToEvents();
    return unsubscribe;
  }, [fetchSessions, subscribeToEvents]);

  // On first load, restore tabs for existing terminal sessions
  useEffect(() => {
    if (sessions.length > 0 && tabs.length === 0) {
      const terminalSessions = sessions.filter((s) => s.session_type === "terminal");
      for (const session of terminalSessions) {
        openTab(session.session_id, session.name);
      }
    }
    // Only run this once when sessions first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length > 0 && tabs.length === 0]);

  const handleNewTab = useCallback(async () => {
    setIsCreating(true);
    try {
      await createSession();
    } catch (err) {
      console.error("Failed to create terminal session:", err);
    } finally {
      setIsCreating(false);
    }
  }, [createSession]);

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      // Close the PTY session on server
      try {
        await closeSession(tab.sessionId);
      } catch (err) {
        console.error("Failed to close PTY session:", err);
        // Still close the tab locally
        closeTab(tabId);
      }
    },
    [tabs, closeSession, closeTab]
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (isLoading && sessions.length === 0 && tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Loading terminal sessions…</span>
      </div>
    );
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-muted">
          <Terminal className="size-7 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-medium">No terminal sessions</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Open a new terminal to get a full shell session. Sessions persist even if you navigate away.
          </p>
        </div>
        <button
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          onClick={handleNewTab}
          disabled={isCreating}
        >
          {isCreating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Terminal className="size-4" />
          )}
          New Terminal
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        isCreating={isCreating}
      />

      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <TerminalInstance
            key={tab.sessionId}
            sessionId={tab.sessionId}
            isActive={tab.id === activeTabId}
          />
        ))}
      </div>
    </div>
  );
}
