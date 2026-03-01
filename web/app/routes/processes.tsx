import { useEffect, useState } from "react";
import {
  Play,
  Square,
  RotateCcw,
  Trash2,
  Plus,
  Loader2,
  Terminal,
  MoreHorizontal,
} from "lucide-react";

import { AppHeader } from "~/components/app-header";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  useProcessStore,
  type ProcessInfo,
  type ProcessStatus,
  type CreateProcessRequest,
} from "~/stores/process-store";
import { formatDuration } from "~/lib/format";

export function meta() {
  return [
    { title: "Processes — XDeck" },
    { name: "description", content: "Manage your processes with XDeck" },
  ];
}

// ── Status Badge ────────────────────────────────────────────────

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
        <span className="mr-1.5 size-1.5 rounded-full bg-white animate-pulse" />
      )}
      {config.label}
    </Badge>
  );
}

// ── Process Table / Cards ───────────────────────────────────────

function ProcessRow({
  process,
  onAction,
}: {
  process: ProcessInfo;
  onAction: (action: string, id: string) => void;
}) {
  const isRunning = process.status === "running";
  const isStopped =
    process.status === "stopped" ||
    process.status === "created" ||
    process.status === "failed" ||
    process.status === "errored";

  return (
    <div className="group flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50">
      {/* Status indicator */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{process.name}</span>
            <StatusBadge status={process.status} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Terminal className="size-3" />
            <span className="truncate font-mono">
              {process.command} {process.args.join(" ")}
            </span>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground tabular-nums">
        {process.pid && <span className="font-mono">PID {process.pid}</span>}
        {process.started_at && <span>{formatDuration(process.started_at)}</span>}
        {process.restart_count > 0 && (
          <span className="text-amber-500">↻ {process.restart_count}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {isStopped && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
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
              className="size-8 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
              onClick={() => onAction("restart", process.id)}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10"
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

// ── Create Process Dialog ───────────────────────────────────────

function CreateProcessDialog({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { createProcess } = useProcessStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    command: "",
    args: "",
    cwd: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const req: CreateProcessRequest = {
        name: form.name,
        command: form.command,
        args: form.args ? form.args.split(/\s+/) : [],
        cwd: form.cwd || ".",
      };
      await createProcess(req);
      setOpen(false);
      setForm({ name: "", command: "", args: "", cwd: "" });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create process");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          New Process
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Process</DialogTitle>
          <DialogDescription>
            Define a new managed process. It will be created in stopped state.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proc-name">Name</Label>
            <Input
              id="proc-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="my-app"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proc-command">Command</Label>
            <Input
              id="proc-command"
              value={form.command}
              onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
              placeholder="node"
              className="font-mono"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proc-args">Arguments</Label>
            <Input
              id="proc-args"
              value={form.args}
              onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
              placeholder="server.js --port 3000"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proc-cwd">Working Directory</Label>
            <Input
              id="proc-cwd"
              value={form.cwd}
              onChange={(e) => setForm((f) => ({ ...f, cwd: e.target.value }))}
              placeholder="/home/user/app"
              className="font-mono"
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create Process
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ───────────────────────────────────────────────────

export default function ProcessesPage() {
  const {
    processes,
    isLoading,
    fetchProcesses,
    startProcess,
    stopProcess,
    restartProcess,
    deleteProcess,
    subscribeToEvents,
  } = useProcessStore();

  useEffect(() => {
    fetchProcesses();
    const unsub = subscribeToEvents();
    return unsub;
  }, [fetchProcesses, subscribeToEvents]);

  const handleAction = async (action: string, id: string) => {
    try {
      switch (action) {
        case "start":
          await startProcess(id);
          break;
        case "stop":
          await stopProcess(id);
          break;
        case "restart":
          await restartProcess(id);
          break;
        case "delete":
          await deleteProcess(id);
          break;
      }
    } catch (err) {
      console.error(`Failed to ${action} process:`, err);
    }
  };

  return (
    <>
      <AppHeader title="Processes" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Process Manager</h2>
              <p className="text-sm text-muted-foreground">
                Manage your application processes with auto-restart and monitoring.
              </p>
            </div>
            <CreateProcessDialog onCreated={fetchProcesses} />
          </div>

          {/* Process list */}
          {isLoading && processes.length === 0 ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Loading processes…</span>
              </CardContent>
            </Card>
          ) : processes.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-muted mb-4">
                  <Terminal className="size-6 text-muted-foreground" />
                </div>
                <CardTitle className="text-lg mb-2">No processes yet</CardTitle>
                <CardDescription className="max-w-sm mb-6">
                  Create your first managed process to start monitoring and
                  auto-restarting your applications.
                </CardDescription>
                <CreateProcessDialog onCreated={fetchProcesses} />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {processes.map((process) => (
                <ProcessRow
                  key={process.id}
                  process={process}
                  onAction={handleAction}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
