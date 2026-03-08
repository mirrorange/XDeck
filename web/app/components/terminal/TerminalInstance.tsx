import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { PtyClient } from "~/lib/pty-client";
import { getRpcClient } from "~/lib/rpc-client";

interface TerminalInstanceProps {
  sessionId: string;
  /** Whether this tab is currently visible (active). */
  isActive: boolean;
  /** Called when PTY send capability is ready/gone. */
  onSendInputReady?: (sendInput: ((data: string | Uint8Array) => void) | null) => void;
}

/**
 * A single xterm.js terminal instance connected to a PTY session via WebSocket.
 * Preserves terminal state when hidden (not unmounted, just display:none).
 */
export function TerminalInstance({ sessionId, isActive, onSendInputReady }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyClientRef = useRef<PtyClient | null>(null);
  const initRef = useRef(false);
  const isActiveRef = useRef(isActive);
  const lastResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (!isActiveRef.current) return;

    const ptyClient = ptyClientRef.current;
    if (!ptyClient || ptyClient.state !== "connected") return;

    const lastResize = lastResizeRef.current;
    if (lastResize && lastResize.cols === cols && lastResize.rows === rows) return;

    ptyClient.sendResize(cols, rows);
    lastResizeRef.current = { cols, rows };
  }, []);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Initialize terminal + PTY connection once
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

    // Connect PTY WebSocket
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
        if (state !== "connected" || !isActiveRef.current) return;
        lastResizeRef.current = null;
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          sendResize(dims.cols, dims.rows);
        }
      },
      onClose: () => {
        terminal.writeln("\r\n\x1b[33m[Session disconnected]\x1b[0m");
      },
    });

    ptyClientRef.current = ptyClient;
    ptyClient.connect();

    // Expose send capability to parent
    onSendInputReady?.((data: string | Uint8Array) => {
      ptyClient.sendInput(data);
    });

    // Forward terminal input to PTY
    const dataDisposable = terminal.onData((data) => {
      ptyClient.sendInput(data);
    });

    // Forward terminal binary input
    const binaryDisposable = terminal.onBinary((data) => {
      const buffer = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        buffer[i] = data.charCodeAt(i);
      }
      ptyClient.sendInput(buffer);
    });

    // Forward resize to PTY
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
    });

    return () => {
      onSendInputReady?.(null);
      dataDisposable.dispose();
      binaryDisposable.dispose();
      resizeDisposable.dispose();
      ptyClient.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      ptyClientRef.current = null;
      lastResizeRef.current = null;
      initRef.current = false;
    };
  }, [sessionId, sendResize]);

  // Handle fit when becoming active or window resize
  const handleResize = useCallback(() => {
    if (isActive && fitAddonRef.current && terminalRef.current) {
      try {
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          sendResize(dims.cols, dims.rows);
        }
      } catch {
        // ignore fit errors during transitions
      }
    }
  }, [isActive, sendResize]);

  useEffect(() => {
    if (isActive) {
      // Small delay to let DOM update
      const timer = setTimeout(handleResize, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, handleResize]);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  // Focus terminal when it becomes active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{
        display: isActive ? "block" : "none",
        backgroundColor: "#0a0a0a",
      }}
    />
  );
}
