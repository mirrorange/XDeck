import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { PtyClient } from "~/lib/pty-client";
import { getRpcClient } from "~/lib/rpc-client";
import { Loader2, TerminalSquare, Unplug } from "lucide-react";
import { Button } from "~/components/ui/button";

interface ProcessPtyViewProps {
  sessionId: string;
  onClose: () => void;
  processName: string;
}

/**
 * PTY terminal view for a process detail page.
 * Similar to TerminalInstance but with a close button header.
 */
export function ProcessPtyView({ sessionId, onClose, processName }: ProcessPtyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyClientRef = useRef<PtyClient | null>(null);
  const initRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);

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
        setIsConnected(state === "connected");
      },
      onClose: () => {
        terminal.writeln("\r\n\x1b[33m[Session disconnected]\x1b[0m");
      },
    });

    ptyClientRef.current = ptyClient;
    ptyClient.connect();

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
    };
  }, [sessionId]);

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center justify-between border-b bg-background/80 px-3">
        <div className="flex items-center gap-2 text-sm">
          <TerminalSquare className="size-4 text-muted-foreground" />
          <span className="font-medium">{processName}</span>
          <span className="text-xs text-muted-foreground">PTY Session</span>
          {isConnected ? (
            <span className="ml-1 inline-flex size-2 rounded-full bg-green-500" />
          ) : (
            <span className="ml-1 inline-flex size-2 rounded-full bg-yellow-500" />
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
          <Unplug className="mr-1 size-3" />
          Disconnect
        </Button>
      </div>
      <div
        ref={containerRef}
        className="flex-1"
        style={{ backgroundColor: "#0a0a0a" }}
      />
    </div>
  );
}

/**
 * Placeholder shown when process has pty_mode but no active session.
 */
export function ProcessPtyPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Waiting for PTY session… Start the process to get a terminal.
      </p>
    </div>
  );
}
