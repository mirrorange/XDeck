import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Download,
  FileText,
  Layers,
  Loader2,
  ScrollText,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "~/components/responsive-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { getRpcClient } from "~/lib/rpc-client";
import {
  type LogLine,
  type LogsResponse,
  useProcessStore,
} from "~/stores/process-store";

// ── Types ──────────────────────────────────────────────────────

type StreamFilter = "all" | "stdout" | "stderr";

// ── Export Range Modal ─────────────────────────────────────────

function ExportRangeModal({
  open,
  onOpenChange,
  totalLines,
  processName,
  instanceCount,
  selectedInstance,
  processId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalLines: number;
  processName: string;
  instanceCount: number;
  selectedInstance: number;
  processId: string;
}) {
  const { fetchLogs } = useProcessStore();
  const [range, setRange] = useState<[number, number]>([0, totalLines]);
  const [exportStream, setExportStream] = useState<StreamFilter>("all");
  const [exporting, setExporting] = useState(false);

  // Reset range when totalLines changes or dialog opens
  useEffect(() => {
    if (open) {
      setRange([0, totalLines]);
    }
  }, [open, totalLines]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const [startLine, endLine] = range;
      const count = endLine - startLine;
      if (count <= 0) return;

      // Fetch full log content in chunks if needed
      const CHUNK = 2000;
      const allLines: LogLine[] = [];
      let offset = totalLines - endLine; // offset from end (backend paginates from tail)

      let remaining = count;
      while (remaining > 0) {
        const batchSize = Math.min(CHUNK, remaining);
        const res: LogsResponse = await fetchLogs(processId, {
          stream: exportStream,
          lines: batchSize,
          offset,
          instance: selectedInstance,
        });
        allLines.unshift(...res.lines);
        remaining -= res.lines.length;
        offset += res.lines.length;
        if (!res.has_more || res.lines.length === 0) break;
      }

      const suffix = instanceCount > 1 ? `-instance-${selectedInstance}` : "";
      const streamSuffix = exportStream !== "all" ? `-${exportStream}` : "";
      const content = allLines
        .map((line) =>
          exportStream === "all" ? `[${line.stream}] ${line.line}` : line.line,
        )
        .join("\n");

      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${processName}${suffix}${streamSuffix}-logs-L${startLine + 1}-L${endLine}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to export logs:", err);
    } finally {
      setExporting(false);
    }
  };

  const lineCount = range[1] - range[0];

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            Export Log Range
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-5 px-4 py-1 md:px-0">
          {/* Stream filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Stream</label>
            <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 w-fit">
              {(["all", "stdout", "stderr"] as const).map((stream) => (
                <button
                  key={stream}
                  onClick={() => setExportStream(stream)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                    exportStream === stream
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {stream === "all" ? "All" : stream}
                </button>
              ))}
            </div>
          </div>

          {/* Range slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Line range</label>
              <span className="text-xs text-muted-foreground">
                {lineCount.toLocaleString()} line{lineCount !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="px-1">
              <Slider
                min={0}
                max={totalLines}
                step={1}
                value={range}
                onValueChange={(v) => setRange(v as [number, number])}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Line{" "}
                <span className="font-mono font-medium text-foreground">
                  {(range[0] + 1).toLocaleString()}
                </span>
              </span>
              <span>
                Line{" "}
                <span className="font-mono font-medium text-foreground">
                  {range[1].toLocaleString()}
                </span>
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => setRange([0, Math.min(100, totalLines)])}
              >
                First 100
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() =>
                  setRange([Math.max(0, totalLines - 100), totalLines])
                }
              >
                Last 100
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => setRange([0, totalLines])}
              >
                All
              </Button>
            </div>
          </div>

          {/* Instance info */}
          {instanceCount > 1 && (
            <p className="text-xs text-muted-foreground">
              Exporting from{" "}
              <span className="font-medium">Instance {selectedInstance}</span>
            </p>
          )}
        </div>

        <ResponsiveModalFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleExport()}
            disabled={exporting || lineCount === 0}
          >
            {exporting ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="mr-1.5 size-3.5" />
                Export{" "}
                {lineCount > 0 ? `${lineCount.toLocaleString()} lines` : ""}
              </>
            )}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

// ── Log Viewer ─────────────────────────────────────────────────

export function LogViewer({
  processId,
  processName,
  instanceCount,
  onClose,
}: {
  processId: string;
  processName: string;
  instanceCount: number;
  onClose: () => void;
}) {
  const { fetchLogs } = useProcessStore();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalLines, setTotalLines] = useState(0);
  const [streamFilter, setStreamFilter] = useState<StreamFilter>("all");
  const [selectedInstance, setSelectedInstance] = useState(0);
  const [showExportRange, setShowExportRange] = useState(false);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  // Track the scroll position to restore after prepending older logs
  const scrollAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  // Debounce scroll sentinel
  const scrollLoadingRef = useRef(false);

  // ── Initial Load ──────────────────────────────────────────

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLogs(processId, {
        stream: streamFilter,
        lines: 500,
        instance: selectedInstance,
      });
      shouldAutoScrollRef.current = true;
      setLogs(res.lines);
      setHasMore(res.has_more);
      setTotalLines(res.total_lines);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchLogs, processId, selectedInstance, streamFilter]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // ── Real-time log streaming ───────────────────────────────

  useEffect(() => {
    const rpc = getRpcClient();
    const unsubscribe = rpc.on("event.process.log", (params: unknown) => {
      const data = params as {
        process_id: string;
        instance: number;
        stream: string;
        line: string;
      };
      if (data.process_id !== processId) return;
      if (data.instance !== selectedInstance) return;
      if (streamFilter !== "all" && data.stream !== streamFilter) return;

      setLogs((prev) => [
        ...prev,
        {
          stream: data.stream,
          line: data.line,
          timestamp: new Date().toISOString(),
        },
      ]);
      setTotalLines((t) => t + 1);
    });

    return unsubscribe;
  }, [processId, selectedInstance, streamFilter]);

  // ── Auto-scroll to bottom ─────────────────────────────────

  useEffect(() => {
    if (shouldAutoScrollRef.current && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // ── Restore scroll after prepending older logs ────────────

  useEffect(() => {
    if (scrollAnchorRef.current && logContainerRef.current) {
      const { scrollHeight: prevHeight, scrollTop: prevTop } =
        scrollAnchorRef.current;
      const newHeight = logContainerRef.current.scrollHeight;
      logContainerRef.current.scrollTop = prevTop + (newHeight - prevHeight);
      scrollAnchorRef.current = null;
    }
  }, [logs]);

  // ── Scroll handler: detect top for auto-load, bottom for auto-scroll ──

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    shouldAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;

    // Auto-load more when near the top
    if (
      scrollTop < 80 &&
      hasMore &&
      !scrollLoadingRef.current &&
      !loadingMore
    ) {
      void handleLoadMore();
    }
  };

  // ── Load more (earlier logs) ──────────────────────────────

  const handleLoadMore = async () => {
    if (scrollLoadingRef.current || loadingMore) return;
    scrollLoadingRef.current = true;
    setLoadingMore(true);
    try {
      // Capture scroll position before prepend
      if (logContainerRef.current) {
        scrollAnchorRef.current = {
          scrollHeight: logContainerRef.current.scrollHeight,
          scrollTop: logContainerRef.current.scrollTop,
        };
      }
      const res = await fetchLogs(processId, {
        stream: streamFilter,
        lines: 300,
        offset: logs.length,
        instance: selectedInstance,
      });
      setLogs((prev) => [...res.lines, ...prev]);
      setHasMore(res.has_more);
      setTotalLines(res.total_lines);
    } catch (err) {
      console.error("Failed to load more logs:", err);
    } finally {
      setLoadingMore(false);
      // Small debounce before allowing next load
      setTimeout(() => {
        scrollLoadingRef.current = false;
      }, 400);
    }
  };

  // ── Export current view ───────────────────────────────────

  const handleDownloadCurrent = () => {
    const suffix = instanceCount > 1 ? `-instance-${selectedInstance}` : "";
    const streamSuffix = streamFilter !== "all" ? `-${streamFilter}` : "";
    const content = logs
      .map((line) =>
        streamFilter === "all" ? `[${line.stream}] ${line.line}` : line.line,
      )
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${processName}${suffix}${streamSuffix}-logs.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────

  return (
    <>
      <ExportRangeModal
        open={showExportRange}
        onOpenChange={setShowExportRange}
        totalLines={totalLines}
        processName={processName}
        instanceCount={instanceCount}
        selectedInstance={selectedInstance}
        processId={processId}
      />

      <div className="flex h-full flex-col">
        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between border-b bg-background/95 px-4 py-2.5 backdrop-blur-sm">
          {/* Left: back + title + log size indicator */}
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
              <h3 className="font-medium leading-tight">{processName}</h3>
              <p className="text-xs text-muted-foreground">Process Logs</p>
            </div>
            {/* Total log size indicator */}
            {!loading && totalLines > 0 && (
              <div className="ml-1 flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                <ScrollText className="size-3 shrink-0" />
                <span>
                  <span className="font-mono font-medium text-foreground">
                    {totalLines.toLocaleString()}
                  </span>{" "}
                  line{totalLines !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2">
            {/* Stream filter */}
            <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
              {(["all", "stdout", "stderr"] as const).map((stream) => (
                <button
                  key={stream}
                  onClick={() => setStreamFilter(stream)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                    streamFilter === stream
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {stream === "all" ? "All" : stream}
                </button>
              ))}
            </div>
            {/* Export dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                >
                  <Download className="size-3" />
                  Export
                  <ChevronDown className="size-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleDownloadCurrent}>
                  <Download className="size-4" />
                  <div>
                    <div>Export current view</div>
                    <div className="text-xs text-muted-foreground">
                      {logs.length.toLocaleString()} lines shown
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowExportRange(true)}
                  disabled={totalLines === 0}
                >
                  <FileText className="size-4" />
                  <div>
                    <div>Export range…</div>
                    <div className="text-xs text-muted-foreground">
                      Choose line range
                    </div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Instance selector */}
            {instanceCount > 1 && (
              <Select
                value={String(selectedInstance)}
                onValueChange={(value) => setSelectedInstance(Number(value))}
              >
                <SelectTrigger size="sm" className="w-auto">
                  <Layers className="mr-1.5 size-3" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: instanceCount }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      Instance {i}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* ── Log area ── */}
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto bg-[hsl(var(--card))] font-mono text-xs leading-5"
        >
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="mr-2 size-4 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading logs…</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ScrollText className="mb-2 size-8 opacity-50" />
              <p>No logs available</p>
              <p className="mt-1 text-xs">
                Logs will appear here when the process runs.
              </p>
            </div>
          ) : (
            <div className="p-3">
              {/* Load more indicator at top */}
              {loadingMore && (
                <div className="mb-2 flex items-center justify-center gap-2 py-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Loading earlier logs…
                </div>
              )}

              {/* Manual load button (when has_more but not auto-loaded) */}
              {hasMore && !loadingMore && (
                <button
                  onClick={() => void handleLoadMore()}
                  className="mb-2 w-full rounded-md bg-muted/50 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  ↑ Load earlier logs (
                  {(totalLines - logs.length).toLocaleString()} more)
                </button>
              )}

              {/* Log lines */}
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={`flex gap-2 rounded-sm px-1 py-px hover:bg-muted/30 ${
                    log.stream === "stderr"
                      ? "text-red-400"
                      : "text-foreground/90"
                  }`}
                >
                  <span
                    className={`w-10 shrink-0 select-none text-right text-[10px] ${
                      log.stream === "stderr"
                        ? "text-red-500/60"
                        : "text-muted-foreground/50"
                    }`}
                  >
                    {streamFilter === "all" &&
                      (log.stream === "stderr" ? "ERR" : "OUT")}
                  </span>

                  <span className="break-all whitespace-pre-wrap">
                    {log.line}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
