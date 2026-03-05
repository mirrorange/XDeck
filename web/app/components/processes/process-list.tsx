import { useState } from "react";
import {
  ChevronDown,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  ScrollText,
  Square,
  Terminal,
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
            {process.instance_count > 1 && (
              <Badge variant="outline" className="text-xs font-mono tabular-nums">
                ×{process.instance_count}
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
          </div>
        </div>
      </div>

      <div className="hidden items-center gap-6 text-sm text-muted-foreground tabular-nums md:flex">
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
          title="View Logs"
        >
          <ScrollText className="size-4" />
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
