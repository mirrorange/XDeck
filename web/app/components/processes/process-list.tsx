import { useState } from "react";
import {
  Calendar,
  ChevronDown,
  Clock,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Play,
  Repeat,
  RotateCcw,
  ScrollText,
  Square,
  Terminal,
  TerminalSquare,
  Timer,
  Trash2,
} from "lucide-react";

import { formatDuration } from "~/lib/format";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  getAggregateStatus,
  type ProcessInfo,
  type ProcessStatus,
  type Schedule,
} from "~/stores/process-store";

const statusConfig: Record<
  ProcessStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }
> = {
  created: { label: "Created", variant: "secondary" },
  starting: { label: "Starting", variant: "outline", className: "border-blue-500/30 text-blue-500" },
  running: { label: "Running", variant: "default", className: "bg-emerald-500 hover:bg-emerald-500/80" },
  stopped: { label: "Stopped", variant: "secondary" },
  errored: { label: "Errored", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
};

function StatusBadge({ status }: { status: ProcessStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} className={config.className}>
      {status === "running" && (
        <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-white" />
      )}
      {config.label}
    </Badge>
  );
}

function formatScheduleLabel(schedule: Schedule): string {
  switch (schedule.type) {
    case "once":
      return `Once at ${new Date(schedule.run_at).toLocaleString()}`;
    case "daily":
      return `Daily at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
    case "weekly": {
      const days = schedule.weekdays.map((d) => d.slice(0, 3)).join(", ");
      return `${days} at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
    }
    case "interval": {
      const s = schedule.every_seconds;
      if (s >= 3600) return `Every ${Math.floor(s / 3600)}h${s % 3600 >= 60 ? ` ${Math.floor((s % 3600) / 60)}m` : ""}`;
      if (s >= 60) return `Every ${Math.floor(s / 60)}m${s % 60 > 0 ? ` ${s % 60}s` : ""}`;
      return `Every ${s}s`;
    }
  }
}

function ScheduleIcon({ type }: { type: Schedule["type"] }) {
  switch (type) {
    case "once": return <Clock className="size-3" />;
    case "daily": return <Repeat className="size-3" />;
    case "weekly": return <Calendar className="size-3" />;
    case "interval": return <Timer className="size-3" />;
  }
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diff = date.getTime() - now;
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;

  if (absDiff < 60_000) return isPast ? "just now" : "in <1m";
  if (absDiff < 3600_000) {
    const m = Math.floor(absDiff / 60_000);
    return isPast ? `${m}m ago` : `in ${m}m`;
  }
  if (absDiff < 86400_000) {
    const h = Math.floor(absDiff / 3600_000);
    return isPast ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.floor(absDiff / 86400_000);
  return isPast ? `${d}d ago` : `in ${d}d`;
}

export function ProcessRow({
  process,
  onAction,
  onViewLogs,
  showGroupBadge = false,
}: {
  process: ProcessInfo;
  onAction: (action: string, id: string) => void;
  onViewLogs: (id: string) => void;
  showGroupBadge?: boolean;
}) {
  const aggregateStatus = getAggregateStatus(process.instances);
  const isRunning = aggregateStatus === "running";
  const isStopped =
    aggregateStatus === "stopped" ||
    aggregateStatus === "created" ||
    aggregateStatus === "failed" ||
    aggregateStatus === "errored";

  const runningInstances = process.instances.filter((i) => i.status === "running");
  const pids = runningInstances.map((i) => i.pid).filter(Boolean);
  const totalRestarts = process.instances.reduce((sum, i) => sum + i.restart_count, 0);
  const earliestStart = runningInstances
    .map((i) => i.started_at)
    .filter(Boolean)
    .sort()[0];

  return (
    <div className="group flex items-center gap-4 rounded-lg border px-4 py-3 transition-all hover:bg-muted/50 hover:shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{process.name}</span>
            <StatusBadge status={aggregateStatus} />
            {process.mode === "schedule" && process.schedule && (
              <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-500">
                <ScheduleIcon type={process.schedule.type} />
                <span className="ml-1">Schedule</span>
              </Badge>
            )}
            {process.instance_count > 1 && (
              <Badge variant="outline" className="text-xs font-mono tabular-nums">
                ×{process.instance_count}
              </Badge>
            )}
            {process.pty_mode && (
              <Badge variant="outline" className="text-xs border-violet-500/30 text-violet-500">
                <TerminalSquare className="mr-1 size-3" />
                PTY
              </Badge>
            )}
            {showGroupBadge && process.group_name && (
              <Badge variant="outline" className="text-xs">
                {process.group_name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Terminal className="size-3" />
            <span className="truncate font-mono">
              {process.command} {process.args.join(" ")}
            </span>
            {process.mode === "schedule" && process.schedule && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="truncate">{formatScheduleLabel(process.schedule)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="hidden items-center gap-6 text-sm text-muted-foreground tabular-nums md:flex">
        {process.mode === "schedule" && process.schedule_state?.next_run_at && (
          <span className="text-blue-500" title={`Next: ${new Date(process.schedule_state.next_run_at).toLocaleString()}`}>
            Next {formatRelativeTime(process.schedule_state.next_run_at)}
          </span>
        )}
        {process.mode === "schedule" && process.schedule_state && process.schedule_state.trigger_count > 0 && (
          <span title={`Last triggered: ${process.schedule_state.last_triggered_at ? new Date(process.schedule_state.last_triggered_at).toLocaleString() : "never"}`}>
            ⚡ {process.schedule_state.trigger_count}
          </span>
        )}
        {pids.length > 0 && (
          <span className="font-mono">
            PID {pids.length <= 2 ? pids.join(",") : `${pids[0]}…+${pids.length - 1}`}
          </span>
        )}
        {earliestStart && <span>{formatDuration(earliestStart)}</span>}
        {totalRestarts > 0 && (
          <span className="text-amber-500">↻ {totalRestarts}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={() => onViewLogs(process.id)}
          title={process.pty_mode ? "View Terminal" : "View Logs"}
        >
          {process.pty_mode ? <TerminalSquare className="size-4" /> : <ScrollText className="size-4" />}
        </Button>

        {isStopped && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600"
            onClick={() => onAction("start", process.id)}
          >
            <Play className="size-4" />
          </Button>
        )}
        {isRunning && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-amber-500 hover:bg-amber-500/10 hover:text-amber-600"
              onClick={() => onAction("restart", process.id)}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onAction("stop", process.id)}
            >
              <Square className="size-4" />
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onAction("edit", process.id)}>
              <Pencil className="mr-2 size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onViewLogs(process.id)}>
              <ScrollText className="mr-2 size-4" />
              View Logs
            </DropdownMenuItem>
            {isStopped && (
              <DropdownMenuItem onClick={() => onAction("start", process.id)}>
                <Play className="mr-2 size-4" />
                Start
              </DropdownMenuItem>
            )}
            {isRunning && (
              <>
                <DropdownMenuItem onClick={() => onAction("restart", process.id)}>
                  <RotateCcw className="mr-2 size-4" />
                  Restart
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("stop", process.id)}>
                  <Square className="mr-2 size-4" />
                  Stop
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onAction("delete", process.id)}
            >
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function ProcessGroup({
  groupName,
  processes,
  onAction,
  onViewLogs,
  onStartGroup,
  onStopGroup,
}: {
  groupName: string | null;
  processes: ProcessInfo[];
  onAction: (action: string, id: string) => void;
  onViewLogs: (id: string) => void;
  onStartGroup?: (name: string) => void;
  onStopGroup?: (name: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const isUngrouped = groupName === null;
  const label = isUngrouped ? "Ungrouped" : groupName;

  const runningCount = processes.filter(
    (p) => getAggregateStatus(p.instances) === "running"
  ).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-sm">
        <CollapsibleTrigger asChild>
          <div className="flex cursor-pointer select-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform duration-200 ${
                open ? "" : "-rotate-90"
              }`}
            />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <FolderOpen className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{label}</span>
              <Badge variant="secondary" className="text-xs tabular-nums">
                {processes.length}
              </Badge>
              {runningCount > 0 && (
                <Badge
                  variant="default"
                  className="bg-emerald-500/15 text-xs text-emerald-600 hover:bg-emerald-500/15"
                >
                  {runningCount} running
                </Badge>
              )}
            </div>

            {!isUngrouped && onStartGroup && onStopGroup && (
              <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
                  onClick={() => onStartGroup(groupName!)}
                >
                  <Play className="mr-1 size-3" />
                  Start All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => onStopGroup(groupName!)}
                >
                  <Square className="mr-1 size-3" />
                  Stop All
                </Button>
              </div>
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-1 px-2 pb-2">
            {processes.map((process) => (
              <ProcessRow
                key={process.id}
                process={process}
                onAction={onAction}
                onViewLogs={onViewLogs}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function groupProcesses(processes: ProcessInfo[]): Map<string | null, ProcessInfo[]> {
  const groups = new Map<string | null, ProcessInfo[]>();

  for (const process of processes) {
    const key = process.group_name || null;
    const list = groups.get(key) ?? [];
    list.push(process);
    groups.set(key, list);
  }

  const sorted = new Map<string | null, ProcessInfo[]>();
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    sorted.set(key, groups.get(key)!);
  }

  return sorted;
}
