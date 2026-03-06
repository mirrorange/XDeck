import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useProcessStore, type ProcessInfo } from "~/stores/process-store";

// ── Constants ──────────────────────────────────────────────────

/** Default window size: 256KB of raw PTY data fed into xterm */
const DEFAULT_WINDOW_SIZE = 256 * 1024;
/** Bytes to step per fine-tune control */
const FINE_STEP = 64;
/** Bytes to step per coarse control */
const COARSE_STEP = 4096;
/** Auto-play step interval in milliseconds */
const AUTO_PLAY_INTERVAL = 50;
/** Bytes to advance per auto-play tick */
const AUTO_PLAY_STEP = 256;

// ── Helpers ────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getDefaultInstance(process: ProcessInfo): number {
  return process.instances.find((inst) => inst.pty_session_id)?.index ?? 0;
}

// ── Component ──────────────────────────────────────────────────

export function PtyReplayViewer({
  process,
  onClose,
}: {
  process: ProcessInfo;
  onClose: () => void;
}) {
  const { fetchPtyReplay } = useProcessStore();
  const [selectedInstance, setSelectedInstance] = useState(() =>
    getDefaultInstance(process)
  );

  // Total log size and current playback position (byte offset)
  const [totalSize, setTotalSize] = useState(0);
  const [position, setPosition] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  // xterm refs
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initRef = useRef(false);

  // Data cache: raw bytes loaded so far
  const dataRef = useRef<Uint8Array>(new Uint8Array(0));
  const loadedUpToRef = useRef(0);

  // ── Terminal setup ──────────────────────────────────────────

  useEffect(() => {
    if (initRef.current || !containerRef.current) return;
    initRef.current = true;

    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 13,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#0c0c0e",
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
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => fitAddon.fit());

    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initRef.current = false;
    };
  }, []);

  // ── Window resize ───────────────────────────────────────────

  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("resize", handleResize);
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, []);

  // ── Data loading ────────────────────────────────────────────

  const loadData = useCallback(
    async (targetOffset: number) => {
      // We always load from the beginning up to targetOffset in chunks
      // But to avoid loading everything from scratch each time,
      // we cache already loaded data and only fetch new ranges.
      const needFrom = loadedUpToRef.current;
      const needTo = targetOffset;

      if (needTo <= needFrom) return; // Already have this data

      try {
        // Load in chunks of DEFAULT_WINDOW_SIZE
        let offset = needFrom;
        const chunks: Uint8Array[] = [dataRef.current];

        while (offset < needTo) {
          const length = Math.min(DEFAULT_WINDOW_SIZE, needTo - offset);
          const resp = await fetchPtyReplay(process.id, {
            instance: selectedInstance,
            offset,
            length,
          });
          setTotalSize(resp.total_size);

          if (resp.length === 0) break;

          // Decode base64
          const binary = atob(resp.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          chunks.push(bytes);
          offset += resp.length;
        }

        // Merge chunks
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Uint8Array(totalLength);
        let pos = 0;
        for (const chunk of chunks) {
          merged.set(chunk, pos);
          pos += chunk.length;
        }
        dataRef.current = merged;
        loadedUpToRef.current = merged.length;
      } catch (err) {
        console.error("Failed to load PTY replay data:", err);
      }
    },
    [fetchPtyReplay, process.id, selectedInstance]
  );

  // ── Initial load: get total size ────────────────────────────

  useEffect(() => {
    setIsLoading(true);
    dataRef.current = new Uint8Array(0);
    loadedUpToRef.current = 0;

    fetchPtyReplay(process.id, {
      instance: selectedInstance,
      offset: 0,
      length: 0,
    })
      .then((resp) => {
        setTotalSize(resp.total_size);
        setPosition(0);
        setIsLoading(false);

        // Pre-load first chunk
        if (resp.total_size > 0) {
          const initialLoad = Math.min(DEFAULT_WINDOW_SIZE, resp.total_size);
          void loadData(initialLoad).then(() => {
            setPosition(initialLoad);
          });
        }
      })
      .catch((err) => {
        console.error("Failed to initialize PTY replay:", err);
        setIsLoading(false);
      });
  }, [fetchPtyReplay, loadData, process.id, selectedInstance]);

  // ── Replay rendering ────────────────────────────────────────

  const renderAtPosition = useCallback(
    async (pos: number) => {
      const terminal = terminalRef.current;
      if (!terminal) return;

      // Ensure data is loaded up to pos
      if (pos > loadedUpToRef.current) {
        await loadData(pos);
      }

      // Reset terminal and replay
      terminal.reset();

      // Determine window start: for large logs, only replay the last
      // DEFAULT_WINDOW_SIZE bytes to keep performance reasonable
      const windowStart = Math.max(0, pos - DEFAULT_WINDOW_SIZE);
      const slice = dataRef.current.slice(windowStart, pos);

      if (slice.length > 0) {
        terminal.write(slice);
      }
    },
    [loadData]
  );

  // Render when position changes
  useEffect(() => {
    if (!isLoading && position >= 0) {
      void renderAtPosition(position);
    }
  }, [position, isLoading, renderAtPosition]);

  // ── Auto-play ───────────────────────────────────────────────

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setPosition((prev) => {
        const next = Math.min(prev + AUTO_PLAY_STEP, totalSize);
        if (next >= totalSize) {
          setIsPlaying(false);
        }
        return next;
      });
    }, AUTO_PLAY_INTERVAL);

    return () => clearInterval(interval);
  }, [isPlaying, totalSize]);

  // ── Slider change ───────────────────────────────────────────

  const handleSliderChange = useCallback(
    (values: number[]) => {
      const value = values[0];
      setIsPlaying(false);
      setPosition(value);
    },
    []
  );

  // ── Controls ────────────────────────────────────────────────

  const stepPosition = useCallback(
    (delta: number) => {
      setIsPlaying(false);
      setPosition((prev) => Math.max(0, Math.min(prev + delta, totalSize)));
    },
    [totalSize]
  );

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setPosition(0);
  }, []);

  const togglePlay = useCallback(() => {
    if (position >= totalSize) {
      setPosition(0);
    }
    setIsPlaying((prev) => !prev);
  }, [position, totalSize]);

  // ── Progress percentage ─────────────────────────────────────

  const progress = totalSize > 0 ? (position / totalSize) * 100 : 0;

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* ── Header ───────────────────────────────────── */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onClose}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div>
              <h3 className="font-medium">{process.name}</h3>
              <p className="text-xs text-muted-foreground">
                Terminal Replay
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {process.instance_count > 1 && (
              <Select
                value={String(selectedInstance)}
                onValueChange={(value) =>
                  setSelectedInstance(Number(value))
                }
              >
                <SelectTrigger size="sm" className="w-auto">
                  <Layers className="mr-1.5 size-3" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(
                    { length: process.instance_count },
                    (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        Instance {i}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            )}

            {/* Size info badge */}
            <div className="flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground">
              <span className="font-mono">{formatBytes(totalSize)}</span>
              <span className="text-muted-foreground/50">total</span>
            </div>
          </div>
        </div>

        {/* ── Terminal viewport ─────────────────────────── */}
        <div className="relative flex-1 overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0c0c0e]/80">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading replay data…
              </span>
            </div>
          )}
          <div
            ref={containerRef}
            className="h-full"
            style={{ backgroundColor: "#0c0c0e" }}
          />
        </div>

        {/* ── Playback controls ────────────────────────── */}
        <div className="border-t bg-card/50 backdrop-blur-sm">
          {/* Slider */}
          <div className="px-4 pt-3">
            <Slider
              min={0}
              max={totalSize || 1}
              value={[position]}
              onValueChange={handleSliderChange}
              className="w-full"
              disabled={totalSize === 0}
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground/60">
              <span>0</span>
              <span>{formatBytes(totalSize)}</span>
            </div>
          </div>

          {/* Controls bar */}
          <div className="flex items-center justify-between px-4 pb-3 pt-1">
            {/* Left: position info */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Position
                </span>
                <span className="font-mono text-xs font-medium tabular-nums">
                  {formatBytes(position)}
                </span>
                <span className="text-[10px] text-muted-foreground/40">
                  ({progress.toFixed(1)}%)
                </span>
              </div>
            </div>

            {/* Center: playback controls */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={handleReset}
                    disabled={totalSize === 0}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to start</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => stepPosition(-COARSE_STEP)}
                    disabled={position <= 0 || totalSize === 0}
                  >
                    <ChevronsLeft className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Back {formatBytes(COARSE_STEP)}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => stepPosition(-FINE_STEP)}
                    disabled={position <= 0 || totalSize === 0}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Back {formatBytes(FINE_STEP)}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => stepPosition(-1)}
                    disabled={position <= 0 || totalSize === 0}
                  >
                    <Minus className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Back 1 byte</TooltipContent>
              </Tooltip>

              <Button
                variant={isPlaying ? "default" : "outline"}
                size="icon"
                className="mx-1 size-8"
                onClick={togglePlay}
                disabled={totalSize === 0}
              >
                {isPlaying ? (
                  <Pause className="size-3.5" />
                ) : (
                  <Play className="size-3.5" />
                )}
              </Button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => stepPosition(1)}
                    disabled={position >= totalSize || totalSize === 0}
                  >
                    <Plus className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Forward 1 byte</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => stepPosition(FINE_STEP)}
                    disabled={position >= totalSize || totalSize === 0}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Forward {formatBytes(FINE_STEP)}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => stepPosition(COARSE_STEP)}
                    disabled={position >= totalSize || totalSize === 0}
                  >
                    <ChevronsRight className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Forward {formatBytes(COARSE_STEP)}
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Right: window info */}
            <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Window
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatBytes(
                  Math.min(position, DEFAULT_WINDOW_SIZE)
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
