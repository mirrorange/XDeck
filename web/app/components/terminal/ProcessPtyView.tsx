import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { PtyClient } from "~/lib/pty-client";
import { getRpcClient } from "~/lib/rpc-client";
import { Loader2 } from "lucide-react";

interface ProcessPtyViewProps {
  sessionId: string;
  onConnectionChange?: (connected: boolean) => void;
  onSendInputReady?: (sendInput: ((data: string) => void) | null) => void;
}

/**
 * PTY terminal body for a process detail page.
 */
export function ProcessPtyView({ sessionId, onConnectionChange, onSendInputReady }: ProcessPtyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyClientRef = useRef<PtyClient | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || !containerRef.current) return;
    initRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#3b3b3b",
        black: "#171717",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#d4d4d4",
        brightBlack: "#525252",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    const token = getRpcClient().token;
    if (!token) {
      terminal.writeln("\r\n\x1b[31mError: Not authenticated. Please log in.\x1b[0m");
      return;
    }

    const ptyClient = new PtyClient({
      sessionId,
      token,
      onData: (data) => {
        terminal.write(data);
      },
      onStateChange: (state) => {
        onConnectionChange?.(state === "connected");
      },
      onClose: () => {
        onConnectionChange?.(false);
        terminal.writeln("\r\n\x1b[33m[Session disconnected]\x1b[0m");
      },
    });

    ptyClientRef.current = ptyClient;
    ptyClient.connect();

    onSendInputReady?.((data: string) => {
      ptyClient.sendInput(data);
    });

    const dataDisposable = terminal.onData((data) => {
      ptyClient.sendInput(data);
    });

    const binaryDisposable = terminal.onBinary((data) => {
      const buffer = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        buffer[i] = data.charCodeAt(i);
      }
      ptyClient.sendInput(buffer);
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      ptyClient.sendResize(cols, rows);
    });

    const initialResizeTimer = setTimeout(() => {
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ptyClient.sendResize(dims.cols, dims.rows);
      }
    }, 200);

    return () => {
      onSendInputReady?.(null);
      clearTimeout(initialResizeTimer);
      dataDisposable.dispose();
      binaryDisposable.dispose();
      resizeDisposable.dispose();
      ptyClient.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      ptyClientRef.current = null;
      initRef.current = false;
      onConnectionChange?.(false);
    };
  }, [onConnectionChange, onSendInputReady, sessionId]);

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current) {
      try {
        fitAddonRef.current.fit();
      } catch {
        // ignore fit errors during transitions
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  useEffect(() => {
    const timer = setTimeout(handleResize, 100);
    return () => clearTimeout(timer);
  }, [handleResize]);

  return <div ref={containerRef} className="h-full" style={{ backgroundColor: "#0a0a0a" }} />;
}

/**
 * Placeholder shown when process has pty_mode but no active session.
 */
export function ProcessPtyPlaceholder({
  title = "Waiting for PTY session…",
  description = "Start the process to get a terminal.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
