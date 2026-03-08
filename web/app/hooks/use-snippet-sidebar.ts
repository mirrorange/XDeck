import { useCallback, useEffect, useRef, useState } from "react";
import { useSnippetStore } from "~/stores/snippet-store";

/**
 * Hook to manage snippet sidebar state and execution for terminal views.
 *
 * Provides:
 * - `snippetOpen` / `toggleSnippet` for sidebar visibility
 * - `registerSendInput` / `unregisterSendInput` for tracking per-session send fns
 * - `executeSnippet` sends a multiline snippet to the active terminal
 */
export function useSnippetSidebar() {
  const [snippetOpen, setSnippetOpen] = useState(false);
  const { fetchSnippets } = useSnippetStore();
  const sendInputMap = useRef<Map<string, (data: string) => void>>(new Map());
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);

  // Fetch snippets on first open
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (snippetOpen && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      void fetchSnippets();
    }
  }, [snippetOpen, fetchSnippets]);

  const toggleSnippet = useCallback(() => {
    setSnippetOpen((prev) => !prev);
  }, []);

  const setActiveSessionId = useCallback((id: string | null) => {
    setActiveSessionIdState(id);
  }, []);

  const registerSendInput = useCallback((sessionId: string, sendInput: (data: string) => void) => {
    sendInputMap.current.set(sessionId, sendInput);
  }, []);

  const unregisterSendInput = useCallback((sessionId: string) => {
    sendInputMap.current.delete(sessionId);
  }, []);

  /**
   * Execute a snippet command in the active terminal.
   * Multiline commands (newline-separated) are sent line-by-line,
   * each terminated with \r to simulate pressing Enter.
   */
  const executeSnippet = useCallback(
    (command: string) => {
      if (!activeSessionId) return;
      const sendInput = sendInputMap.current.get(activeSessionId);
      if (!sendInput) return;

      const lines = command.split("\n");
      for (const line of lines) {
        sendInput(line + "\r");
      }
    },
    [activeSessionId]
  );

  return {
    snippetOpen,
    toggleSnippet,
    setActiveSessionId,
    registerSendInput,
    unregisterSendInput,
    executeSnippet,
  };
}
