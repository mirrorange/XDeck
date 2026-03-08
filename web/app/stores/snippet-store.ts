import { create } from "zustand";
import { getRpcClient } from "~/lib/rpc-client";
import type { SnippetExecutionMode } from "~/lib/snippet-execution";

// -- Types -------------------------------------------------------

export interface SnippetInfo {
  id: string;
  name: string;
  command: string;
  tags: string[];
  execution_mode: SnippetExecutionMode;
  created_at: string;
  updated_at: string;
}

interface SnippetState {
  snippets: SnippetInfo[];
  isLoading: boolean;

  fetchSnippets: () => Promise<void>;
  createSnippet: (params: {
    name: string;
    command: string;
    tags?: string[];
    execution_mode?: SnippetExecutionMode;
  }) => Promise<SnippetInfo>;
  updateSnippet: (params: {
    id: string;
    name?: string;
    command?: string;
    tags?: string[];
    execution_mode?: SnippetExecutionMode;
  }) => Promise<SnippetInfo>;
  deleteSnippet: (id: string) => Promise<void>;
}

// -- Store -------------------------------------------------------

export const useSnippetStore = create<SnippetState>((set) => ({
  snippets: [],
  isLoading: false,

  fetchSnippets: async () => {
    set({ isLoading: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ snippets: SnippetInfo[] }>("snippet.list");
      set({ snippets: result.snippets, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch snippets:", err);
      set({ isLoading: false });
    }
  },

  createSnippet: async (params) => {
    const rpc = getRpcClient();
    const snippet = await rpc.call<SnippetInfo>("snippet.create", params);
    set((state) => ({
      snippets: [snippet, ...state.snippets],
    }));
    return snippet;
  },

  updateSnippet: async (params) => {
    const rpc = getRpcClient();
    const snippet = await rpc.call<SnippetInfo>("snippet.update", params);
    set((state) => ({
      snippets: state.snippets.map((s) => (s.id === snippet.id ? snippet : s)),
    }));
    return snippet;
  },

  deleteSnippet: async (id) => {
    const rpc = getRpcClient();
    await rpc.call("snippet.delete", { id });
    set((state) => ({
      snippets: state.snippets.filter((s) => s.id !== id),
    }));
  },
}));
