import { create } from "zustand";
import { getRpcClient } from "~/lib/rpc-client";

// -- Types -------------------------------------------------------

export type FileType = "file" | "directory" | "symlink" | "other";

export type ViewMode = "list" | "grid";

export type SortField = "name" | "size" | "modified" | "type";
export type SortDirection = "asc" | "desc";

export interface FileEntry {
  name: string;
  path: string;
  type: FileType;
  size: number;
  modified: string | null;
  created: string | null;
  readonly: boolean;
  mode: number | null;
  uid: number | null;
  gid: number | null;
  owner: string | null;
  group: string | null;
  symlink_target: string | null;
  hidden: boolean;
}

export interface DirListing {
  path: string;
  entries: FileEntry[];
  total: number;
}

export interface FileTab {
  id: string;
  path: string;
  label: string;
  entries: FileEntry[];
  isLoading: boolean;
  error: string | null;
  selectedPaths: Set<string>;
  sortField: SortField;
  sortDirection: SortDirection;
  history: string[];
  historyIndex: number;
}

interface FileStore {
  tabs: FileTab[];
  activeTabId: string | null;
  viewMode: ViewMode;
  showHidden: boolean;

  // Tab management
  addTab: (path?: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // Navigation
  navigateTo: (tabId: string, path: string) => Promise<void>;
  goBack: (tabId: string) => void;
  goForward: (tabId: string) => void;
  goUp: (tabId: string) => void;
  refresh: (tabId: string) => Promise<void>;

  // Selection
  selectFile: (tabId: string, path: string, multi?: boolean) => void;
  selectRange: (tabId: string, path: string) => void;
  selectAll: (tabId: string) => void;
  clearSelection: (tabId: string) => void;

  // View
  setViewMode: (mode: ViewMode) => void;
  toggleHidden: () => void;
  setSortField: (tabId: string, field: SortField) => void;

  // Helpers
  getActiveTab: () => FileTab | null;
  getHomeDir: () => Promise<string>;
}

let nextTabId = 1;

function createTab(path: string): FileTab {
  const id = `tab-${nextTabId++}`;
  return {
    id,
    path,
    label: path.split("/").filter(Boolean).pop() || "/",
    entries: [],
    isLoading: false,
    error: null,
    selectedPaths: new Set(),
    sortField: "name",
    sortDirection: "asc",
    history: [path],
    historyIndex: 0,
  };
}

function updateTab(tabs: FileTab[], tabId: string, updates: Partial<FileTab>): FileTab[] {
  return tabs.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab));
}

function sortEntries(entries: FileEntry[], field: SortField, direction: SortDirection): FileEntry[] {
  const sorted = [...entries].sort((a, b) => {
    // Always put directories first
    const aIsDir = a.type === "directory" ? 0 : 1;
    const bIsDir = b.type === "directory" ? 0 : 1;
    if (aIsDir !== bIsDir) return aIsDir - bIsDir;

    let cmp = 0;
    switch (field) {
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        break;
      case "size":
        cmp = a.size - b.size;
        break;
      case "modified":
        cmp = (a.modified ?? "").localeCompare(b.modified ?? "");
        break;
      case "type": {
        const extA = a.name.includes(".") ? a.name.split(".").pop()! : "";
        const extB = b.name.includes(".") ? b.name.split(".").pop()! : "";
        cmp = extA.localeCompare(extB);
        break;
      }
    }
    return direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export const useFileStore = create<FileStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  viewMode: "list",
  showHidden: false,

  addTab: (path) => {
    const state = get();
    const tabPath = path || "/";
    const tab = createTab(tabPath);
    set({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    });
    // Load contents
    void get().navigateTo(tab.id, tabPath);
  },

  closeTab: (tabId) => {
    const state = get();
    const filtered = state.tabs.filter((t) => t.id !== tabId);
    let newActive = state.activeTabId;

    if (state.activeTabId === tabId) {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (filtered.length > 0) {
        newActive = filtered[Math.min(idx, filtered.length - 1)].id;
      } else {
        newActive = null;
      }
    }

    set({ tabs: filtered, activeTabId: newActive });
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  navigateTo: async (tabId, path) => {
    set((s) => ({ tabs: updateTab(s.tabs, tabId, { isLoading: true, error: null }) }));

    try {
      const rpc = getRpcClient();
      const result = (await rpc.call("fs.list", { path })) as DirListing;

      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return;

      const showHidden = get().showHidden;
      const filtered = showHidden
        ? result.entries
        : result.entries.filter((e) => !e.hidden);
      const sorted = sortEntries(filtered, tab.sortField, tab.sortDirection);

      // Update history
      const newHistory = tab.history.slice(0, tab.historyIndex + 1);
      if (newHistory[newHistory.length - 1] !== result.path) {
        newHistory.push(result.path);
      }

      set((s) => ({
        tabs: updateTab(s.tabs, tabId, {
          path: result.path,
          label: result.path.split("/").filter(Boolean).pop() || "/",
          entries: sorted,
          isLoading: false,
          error: null,
          selectedPaths: new Set(),
          history: newHistory,
          historyIndex: newHistory.length - 1,
        }),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list directory";
      set((s) => ({
        tabs: updateTab(s.tabs, tabId, { isLoading: false, error: message }),
      }));
    }
  },

  goBack: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.historyIndex <= 0) return;
    const newIndex = tab.historyIndex - 1;
    const path = tab.history[newIndex];
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, { historyIndex: newIndex }),
    }));
    void get().navigateTo(tabId, path);
  },

  goForward: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    const newIndex = tab.historyIndex + 1;
    const path = tab.history[newIndex];
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, { historyIndex: newIndex }),
    }));
    void get().navigateTo(tabId, path);
  },

  goUp: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const parts = tab.path.split("/").filter(Boolean);
    if (parts.length === 0) return;
    parts.pop();
    const parentPath = "/" + parts.join("/");
    void get().navigateTo(tabId, parentPath);
  },

  refresh: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    void get().navigateTo(tabId, tab.path);
  },

  selectFile: (tabId, path, multi) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;

      const newSelected = new Set(multi ? tab.selectedPaths : []);
      if (newSelected.has(path)) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }

      return { tabs: updateTab(s.tabs, tabId, { selectedPaths: newSelected }) };
    });
  },

  selectRange: (tabId, path) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;

      const entries = tab.entries;
      const lastSelected = [...tab.selectedPaths].pop();
      const startIdx = lastSelected ? entries.findIndex((e) => e.path === lastSelected) : 0;
      const endIdx = entries.findIndex((e) => e.path === path);

      if (startIdx === -1 || endIdx === -1) return s;

      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      const newSelected = new Set(tab.selectedPaths);
      for (let i = lo; i <= hi; i++) {
        newSelected.add(entries[i].path);
      }

      return { tabs: updateTab(s.tabs, tabId, { selectedPaths: newSelected }) };
    });
  },

  selectAll: (tabId) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;

      const newSelected = new Set(tab.entries.map((e) => e.path));
      return { tabs: updateTab(s.tabs, tabId, { selectedPaths: newSelected }) };
    });
  },

  clearSelection: (tabId) => {
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, { selectedPaths: new Set() }),
    }));
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  toggleHidden: () => {
    const state = get();
    set({ showHidden: !state.showHidden });
    // Refresh all tabs
    for (const tab of state.tabs) {
      void get().refresh(tab.id);
    }
  },

  setSortField: (tabId, field) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;

      const newDirection =
        tab.sortField === field && tab.sortDirection === "asc" ? "desc" : "asc";
      const sorted = sortEntries(tab.entries, field, newDirection);

      return {
        tabs: updateTab(s.tabs, tabId, {
          sortField: field,
          sortDirection: newDirection,
          entries: sorted,
        }),
      };
    });
  },

  getActiveTab: () => {
    const state = get();
    return state.tabs.find((t) => t.id === state.activeTabId) || null;
  },

  getHomeDir: async () => {
    const rpc = getRpcClient();
    const result = (await rpc.call("fs.home")) as { path: string };
    return result.path;
  },
}));
