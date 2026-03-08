import { create } from "zustand";
import { getRpcClient } from "~/lib/rpc-client";
import type { SnippetInfo } from "~/stores/snippet-store";

// ── Types ───────────────────────────────────────────────────────

export interface SnippetSourceInfo {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface RemoteSnippet {
  id: string;
  name: string;
  description: string;
  command: string;
  tags: string[];
  execution_mode: string;
  author: string;
  version: string;
}

export interface SourceWithSnippets {
  source: SnippetSourceInfo;
  snippets: RemoteSnippet[];
  error?: string;
}

interface SnippetStoreState {
  sources: SnippetSourceInfo[];
  results: SourceWithSnippets[];
  isLoadingSources: boolean;
  isFetchingSnippets: boolean;
  installingIds: Set<string>;

  fetchSources: () => Promise<void>;
  addSource: (name: string, url: string) => Promise<SnippetSourceInfo>;
  removeSource: (id: string) => Promise<void>;
  fetchRemoteSnippets: () => Promise<void>;
  installSnippet: (snippet: RemoteSnippet) => Promise<SnippetInfo>;
}

// ── Store ───────────────────────────────────────────────────────

export const useSnippetStoreStore = create<SnippetStoreState>((set, get) => ({
  sources: [],
  results: [],
  isLoadingSources: false,
  isFetchingSnippets: false,
  installingIds: new Set(),

  fetchSources: async () => {
    set({ isLoadingSources: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ sources: SnippetSourceInfo[] }>(
        "snippet_store.list_sources"
      );
      set({ sources: result.sources, isLoadingSources: false });
    } catch (err) {
      console.error("Failed to fetch snippet sources:", err);
      set({ isLoadingSources: false });
    }
  },

  addSource: async (name: string, url: string) => {
    const rpc = getRpcClient();
    const source = await rpc.call<SnippetSourceInfo>("snippet_store.add_source", {
      name,
      url,
    });
    set((state) => ({ sources: [...state.sources, source] }));
    return source;
  },

  removeSource: async (id: string) => {
    const rpc = getRpcClient();
    await rpc.call("snippet_store.remove_source", { id });
    set((state) => ({
      sources: state.sources.filter((s) => s.id !== id),
      results: state.results.filter((r) => r.source.id !== id),
    }));
  },

  fetchRemoteSnippets: async () => {
    set({ isFetchingSnippets: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ results: SourceWithSnippets[] }>(
        "snippet_store.fetch_snippets"
      );
      set({ results: result.results, isFetchingSnippets: false });
    } catch (err) {
      console.error("Failed to fetch remote snippets:", err);
      set({ isFetchingSnippets: false });
    }
  },

  installSnippet: async (snippet: RemoteSnippet) => {
    const installing = new Set(get().installingIds);
    installing.add(snippet.id);
    set({ installingIds: installing });

    try {
      const rpc = getRpcClient();
      const result = await rpc.call<SnippetInfo>("snippet_store.install", {
        name: snippet.name,
        command: snippet.command,
        tags: snippet.tags,
        execution_mode: snippet.execution_mode,
      });

      const done = new Set(get().installingIds);
      done.delete(snippet.id);
      set({ installingIds: done });

      return result;
    } catch (err) {
      const done = new Set(get().installingIds);
      done.delete(snippet.id);
      set({ installingIds: done });
      throw err;
    }
  },
}));
