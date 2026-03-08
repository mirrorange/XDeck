import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildSnippetTerminalInput,
  type SnippetExecutionMode,
} from "~/lib/snippet-execution";
import { useSnippetStore, type SnippetInfo } from "~/stores/snippet-store";
import { useSystemStore } from "~/stores/system-store";

type SendInput = (data: string | Uint8Array) => void;

/**
 * Hook to manage snippet sidebar state and execution for terminal views.
 *
 * Provides:
 * - `snippetOpen` / `toggleSnippet` for sidebar visibility
 * - `registerSendInput` / `unregisterSendInput` for tracking per-session send fns
 * - `executeSnippet` applies a snippet using its selected execution mode
 */
export function useSnippetSidebar() {
  const [snippetOpen, setSnippetOpen] = useState(false);
  const { fetchSnippets } = useSnippetStore();
  const daemonInfo = useSystemStore((state) => state.daemonInfo);
  const sendInputMap = useRef<Map<string, SendInput>>(new Map());
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

  const registerSendInput = useCallback((sessionId: string, sendInput: SendInput) => {
    sendInputMap.current.set(sessionId, sendInput);
  }, []);

  const unregisterSendInput = useCallback((sessionId: string) => {
    sendInputMap.current.delete(sessionId);
  }, []);

  /**
   * Apply a snippet to the active terminal using either its default mode,
   * or a one-off mode selected from the overflow menu.
   */
  const executeSnippet = useCallback(
    (
      snippet: Pick<SnippetInfo, "command" | "execution_mode">,
      overrideMode?: SnippetExecutionMode
    ) => {
      if (!activeSessionId) return;
      const sendInput = sendInputMap.current.get(activeSessionId);
      if (!sendInput) return;

      const input = buildSnippetTerminalInput(
        snippet.command,
        overrideMode ?? snippet.execution_mode,
        { isWindows: daemonInfo?.os_type === "windows" }
      );
      if (!input) return;

      sendInput(input);
    },
    [activeSessionId, daemonInfo?.os_type]
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
