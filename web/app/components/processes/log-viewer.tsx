import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ChevronLeft,
  Download,
  Layers,
  Loader2,
  Pause,
  ScrollText,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { getRpcClient } from "~/lib/rpc-client";
import { type LogLine, useProcessStore } from "~/stores/process-store";

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
  const [hasMore, setHasMore] = useState(false);
  const [streamFilter, setStreamFilter] = useState<"all" | "stdout" | "stderr">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedInstance, setSelectedInstance] = useState(0);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLogs(processId, {
        stream: streamFilter,
        lines: 500,
        instance: selectedInstance,
      });
      setLogs(res.lines);
      setHasMore(res.has_more);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchLogs, processId, selectedInstance, streamFilter]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

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
        { stream: data.stream, line: data.line, timestamp: new Date().toISOString() },
      ]);
    });

    return unsubscribe;
  }, [processId, selectedInstance, streamFilter]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const handleDownload = () => {
    const suffix = instanceCount > 1 ? `-instance-${selectedInstance}` : "";
    const content = logs.map((line) => `[${line.stream}] ${line.line}`).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${processName}${suffix}-logs.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loadMore = async () => {
    try {
      const res = await fetchLogs(processId, {
        stream: streamFilter,
        lines: 500,
        offset: logs.length,
        instance: selectedInstance,
      });
      setLogs((prev) => [...res.lines, ...prev]);
      setHasMore(res.has_more);
    } catch (err) {
      console.error("Failed to load more logs:", err);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-8" onClick={onClose}>
            <ChevronLeft className="size-4" />
          </Button>
          <div>
            <h3 className="font-medium">{processName}</h3>
            <p className="text-xs text-muted-foreground">Process Logs</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
            {(["all", "stdout", "stderr"] as const).map((stream) => (
              <button
                key={stream}
                onClick={() => setStreamFilter(stream)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-all ${
                  streamFilter === stream
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {stream === "all" ? "All" : stream}
              </button>
            ))}
          </div>

          <Button
            variant={autoScroll ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            {autoScroll ? <ArrowDown className="mr-1 size-3" /> : <Pause className="mr-1 size-3" />}
            {autoScroll ? "Auto" : "Paused"}
          </Button>

          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleDownload}>
            <Download className="mr-1 size-3" />
            Export
          </Button>

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

      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-[hsl(var(--card))] font-mono text-xs leading-5"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 size-4 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading logs…</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ScrollText className="mb-2 size-8 opacity-50" />
            <p>No logs available</p>
            <p className="mt-1 text-xs">Logs will appear here when the process runs.</p>
          </div>
        ) : (
          <div className="p-3">
            {hasMore && (
              <button
                onClick={() => void loadMore()}
                className="mb-2 w-full rounded-md bg-muted/50 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
              >
                Load earlier logs…
              </button>
            )}
            {logs.map((log, i) => (
              <div
                key={i}
                className={`flex gap-2 rounded-sm px-1 py-px hover:bg-muted/30 ${
                  log.stream === "stderr" ? "text-red-400" : "text-foreground/90"
                }`}
              >
                <span
                  className={`w-10 shrink-0 select-none text-right text-[10px] ${
                    log.stream === "stderr"
                      ? "text-red-500/60"
                      : "text-muted-foreground/50"
                  }`}
                >
                  {log.stream === "stderr" ? "ERR" : "OUT"}
                </span>
                <span className="break-all whitespace-pre-wrap">{log.line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
