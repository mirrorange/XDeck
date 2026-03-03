import { useEffect, useState, useRef, useCallback } from "react";
import {
  Play,
  Square,
  RotateCcw,
  Trash2,
  Plus,
  Loader2,
  Terminal,
  MoreHorizontal,
  ScrollText,
  ChevronRight,
  ChevronLeft,
  X,
  Download,
  ArrowDown,
  Pause,
  Pencil,
} from "lucide-react";

import { AppHeader } from "~/components/app-header";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardTitle, CardDescription } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
  ResponsiveModalFooter,
} from "~/components/responsive-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import {
  useProcessStore,
  type ProcessInfo,
  type ProcessStatus,
  type CreateProcessRequest,
  type UpdateProcessRequest,
  type LogLine,
} from "~/stores/process-store";
import { useSystemStore } from "~/stores/system-store";
import { formatDuration } from "~/lib/format";
import { getRpcClient } from "~/lib/rpc-client";

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

// ── Process Row ─────────────────────────────────────────────────

function ProcessRow({
  process,
  onAction,
  onViewLogs,
}: {
  process: ProcessInfo;
  onAction: (action: string, id: string) => void;
  onViewLogs: (id: string) => void;
}) {
  const isRunning = process.status === "running";
  const isStopped =
    process.status === "stopped" ||
    process.status === "created" ||
    process.status === "failed" ||
    process.status === "errored";

  return (
    <div className="group flex items-center gap-4 rounded-lg border px-4 py-3 transition-all hover:bg-muted/50 hover:shadow-sm">
      {/* Status indicator */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{process.name}</span>
            <StatusBadge status={process.status} />
            {process.group_name && (
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
        {/* Log button */}
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

// ── Wizard Step Indicator ───────────────────────────────────────

function StepIndicator({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-2 flex-1">
          <div
            className={`flex size-7 items-center justify-center rounded-full text-xs font-medium transition-colors ${
              i <= current
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {i + 1}
          </div>
          <span
            className={`text-xs hidden sm:block truncate ${
              i <= current ? "text-foreground font-medium" : "text-muted-foreground"
            }`}
          >
            {step}
          </span>
          {i < steps.length - 1 && (
            <div
              className={`h-px flex-1 ${
                i < current ? "bg-primary" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Create Process Dialog ───────────────────────────────────────

interface CreateFormState {
  name: string;
  command: string;
  args: string;
  cwd: string;
  envKeys: string[];
  envValues: string[];
  restartStrategy: "always" | "on_failure" | "never";
  maxRetries: string;
  delayMs: string;
  backoffMultiplier: string;
  autoStart: boolean;
  groupName: string;
  logMaxFileSize: string;
  logMaxFiles: string;
  runAs: string;
}

const defaultForm: CreateFormState = {
  name: "",
  command: "",
  args: "",
  cwd: "",
  envKeys: [""],
  envValues: [""],
  restartStrategy: "on_failure",
  maxRetries: "10",
  delayMs: "1000",
  backoffMultiplier: "2.0",
  autoStart: true,
  groupName: "",
  logMaxFileSize: "10",
  logMaxFiles: "5",
  runAs: "",
};

function buildEnvFromForm(form: CreateFormState): Record<string, string> {
  const env: Record<string, string> = {};
  form.envKeys.forEach((key, i) => {
    if (key.trim()) {
      env[key.trim()] = form.envValues[i] ?? "";
    }
  });
  return env;
}

function splitArgs(input: string): string[] {
  return input ? input.split(/\s+/).filter(Boolean) : [];
}

function CreateProcessDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const { createProcess } = useProcessStore();
  const { daemonInfo } = useSystemStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CreateFormState>({ ...defaultForm });

  const isWindows = daemonInfo?.os_type === "windows";
  const wizardSteps = ["Basic Info", "Restart Policy", "Advanced"];

  const updateForm = (field: keyof CreateFormState, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const addEnvVar = () => {
    setForm((f) => ({
      ...f,
      envKeys: [...f.envKeys, ""],
      envValues: [...f.envValues, ""],
    }));
  };

  const removeEnvVar = (index: number) => {
    setForm((f) => ({
      ...f,
      envKeys: f.envKeys.filter((_, i) => i !== index),
      envValues: f.envValues.filter((_, i) => i !== index),
    }));
  };

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.name.trim()) return "Name is required";
      if (!form.command.trim()) return "Command is required";
    }
    if (s === 1) {
      if (form.maxRetries && isNaN(Number(form.maxRetries))) return "Max retries must be a number";
      if (form.delayMs && isNaN(Number(form.delayMs))) return "Delay must be a number";
      if (form.backoffMultiplier && isNaN(Number(form.backoffMultiplier)))
        return "Backoff multiplier must be a number";
    }
    return null;
  };

  const nextStep = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, wizardSteps.length - 1));
  };

  const prevStep = () => {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const buildRequest = (): CreateProcessRequest => {
    const env = buildEnvFromForm(form);

    return {
      name: form.name.trim(),
      command: form.command.trim(),
      args: splitArgs(form.args),
      cwd: form.cwd.trim() || ".",
      env: Object.keys(env).length > 0 ? env : undefined,
      restart_policy: {
        strategy: form.restartStrategy,
        max_retries: form.maxRetries ? Number(form.maxRetries) : null,
        delay_ms: Number(form.delayMs) || 1000,
        backoff_multiplier: Number(form.backoffMultiplier) || 2.0,
      },
      auto_start: form.autoStart,
      group_name: form.groupName.trim() || undefined,
      log_config: {
        max_file_size: (Number(form.logMaxFileSize) || 10) * 1024 * 1024,
        max_files: Number(form.logMaxFiles) || 5,
      },
      run_as: !isWindows && form.runAs.trim() ? form.runAs.trim() : undefined,
    };
  };

  const handleSubmit = async () => {
    // Validate all steps
    for (let s = 0; s < wizardSteps.length; s++) {
      const err = validateStep(s);
      if (err) {
        setError(err);
        setStep(s);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await createProcess(buildRequest());
      setOpen(false);
      setForm({ ...defaultForm });
      setStep(0);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create process");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetDialog = () => {
    setForm({ ...defaultForm });
    setStep(0);
    setError(null);
  };

  // ── Form Sections ──────────────────────────────────────────

  const BasicSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="proc-name">Name *</Label>
        <Input
          id="proc-name"
          value={form.name}
          onChange={(e) => updateForm("name", e.target.value)}
          placeholder="my-app"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="proc-command">Command *</Label>
        <Input
          id="proc-command"
          value={form.command}
          onChange={(e) => updateForm("command", e.target.value)}
          placeholder="node"
          className="font-mono"
          required
        />
        <p className="text-xs text-muted-foreground">
          Executable or command to run. Must exist in PATH or be an absolute path.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="proc-args">Arguments</Label>
        <Input
          id="proc-args"
          value={form.args}
          onChange={(e) => updateForm("args", e.target.value)}
          placeholder="server.js --port 3000"
          className="font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="proc-cwd">Working Directory</Label>
        <Input
          id="proc-cwd"
          value={form.cwd}
          onChange={(e) => updateForm("cwd", e.target.value)}
          placeholder="/home/user/app"
          className="font-mono"
        />
      </div>
    </div>
  );

  const RestartSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Restart Strategy</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["on_failure", "always", "never"] as const).map((strategy) => (
            <button
              key={strategy}
              type="button"
              onClick={() => updateForm("restartStrategy", strategy)}
              className={`rounded-lg border px-3 py-2.5 text-sm transition-all ${
                form.restartStrategy === strategy
                  ? "border-primary bg-primary/5 text-primary font-medium ring-1 ring-primary/20"
                  : "hover:bg-muted/50"
              }`}
            >
              {strategy === "on_failure"
                ? "On Failure"
                : strategy === "always"
                ? "Always"
                : "Never"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {form.restartStrategy === "on_failure"
            ? "Restart only when the process exits with a non-zero code."
            : form.restartStrategy === "always"
            ? "Always restart the process when it exits, regardless of exit code."
            : "Never automatically restart the process."}
        </p>
      </div>

      {form.restartStrategy !== "never" && (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="proc-retries">Max Retries</Label>
            <Input
              id="proc-retries"
              type="number"
              min="0"
              value={form.maxRetries}
              onChange={(e) => updateForm("maxRetries", e.target.value)}
              placeholder="10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proc-delay">Delay (ms)</Label>
            <Input
              id="proc-delay"
              type="number"
              min="1"
              value={form.delayMs}
              onChange={(e) => updateForm("delayMs", e.target.value)}
              placeholder="1000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proc-backoff">Backoff ×</Label>
            <Input
              id="proc-backoff"
              type="number"
              min="1"
              step="0.1"
              value={form.backoffMultiplier}
              onChange={(e) => updateForm("backoffMultiplier", e.target.value)}
              placeholder="2.0"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-lg border p-3">
        <input
          type="checkbox"
          id="proc-autostart"
          checked={form.autoStart}
          onChange={(e) => updateForm("autoStart", e.target.checked)}
          className="size-4 rounded"
        />
        <div>
          <Label htmlFor="proc-autostart" className="cursor-pointer">Auto Start</Label>
          <p className="text-xs text-muted-foreground">
            Automatically start this process when the daemon starts.
          </p>
        </div>
      </div>
    </div>
  );

  const AdvancedSection = (
    <div className="space-y-4">
      {/* Group Name */}
      <div className="space-y-2">
        <Label htmlFor="proc-group">Group Name</Label>
        <Input
          id="proc-group"
          value={form.groupName}
          onChange={(e) => updateForm("groupName", e.target.value)}
          placeholder="web-services"
        />
      </div>

      {/* Run As User (Unix only) */}
      {!isWindows && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="proc-runas">Run As User</Label>
            <Badge variant="outline" className="text-[10px]">Unix Only</Badge>
          </div>
          <Input
            id="proc-runas"
            value={form.runAs}
            onChange={(e) => updateForm("runAs", e.target.value)}
            placeholder="www-data"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Username or UID. Requires root privileges. Ignored if not root.
          </p>
        </div>
      )}

      {/* Log Config */}
      <div className="space-y-2">
        <Label>Log Rotation</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="proc-logsize" className="text-xs text-muted-foreground">
              Max File Size (MB)
            </Label>
            <Input
              id="proc-logsize"
              type="number"
              min="1"
              value={form.logMaxFileSize}
              onChange={(e) => updateForm("logMaxFileSize", e.target.value)}
              placeholder="10"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proc-logfiles" className="text-xs text-muted-foreground">
              Rotated Files to Keep
            </Label>
            <Input
              id="proc-logfiles"
              type="number"
              min="1"
              value={form.logMaxFiles}
              onChange={(e) => updateForm("logMaxFiles", e.target.value)}
              placeholder="5"
            />
          </div>
        </div>
      </div>

      {/* Environment Variables */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Environment Variables</Label>
          <Button type="button" variant="outline" size="sm" onClick={addEnvVar} className="h-7 text-xs">
            <Plus className="mr-1 size-3" />
            Add
          </Button>
        </div>
        <div className="space-y-2">
          {form.envKeys.map((key, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={key}
                onChange={(e) => {
                  const k = [...form.envKeys];
                  k[i] = e.target.value;
                  updateForm("envKeys", k);
                }}
                placeholder="KEY"
                className="font-mono flex-1"
              />
              <span className="text-muted-foreground">=</span>
              <Input
                value={form.envValues[i] ?? ""}
                onChange={(e) => {
                  const v = [...form.envValues];
                  v[i] = e.target.value;
                  updateForm("envValues", v);
                }}
                placeholder="value"
                className="font-mono flex-1"
              />
              {form.envKeys.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => removeEnvVar(i)}
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetDialog();
      }}
    >
      <ResponsiveModalTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          New Process
        </Button>
      </ResponsiveModalTrigger>
      <ResponsiveModalContent className="md:max-w-xl">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Create New Process</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Follow the steps to configure your process.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="px-4 md:px-0">
          <StepIndicator steps={wizardSteps} current={step} />
          <div className="min-h-[250px]">
            {step === 0 && BasicSection}
            {step === 1 && RestartSection}
            {step === 2 && AdvancedSection}
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <ResponsiveModalFooter className="gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={prevStep}>
              <ChevronLeft className="mr-1 size-4" />
              Back
            </Button>
          )}
          <div className="flex-1" />
          {step < wizardSteps.length - 1 ? (
            <Button type="button" onClick={nextStep}>
              Next
              <ChevronRight className="ml-1 size-4" />
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create Process
            </Button>
          )}
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function EditProcessDialog({
  process,
  open,
  onOpenChange,
  onUpdated,
}: {
  process: ProcessInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const { updateProcess } = useProcessStore();
  const { daemonInfo } = useSystemStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CreateFormState>({ ...defaultForm });

  const isWindows = daemonInfo?.os_type === "windows";
  const wizardSteps = ["Basic Info", "Restart Policy", "Advanced"];

  useEffect(() => {
    if (!open || !process) return;

    const envEntries = Object.entries(process.env);
    setForm({
      name: process.name,
      command: process.command,
      args: process.args.join(" "),
      cwd: process.cwd,
      envKeys: envEntries.length > 0 ? envEntries.map(([k]) => k) : [""],
      envValues: envEntries.length > 0 ? envEntries.map(([, v]) => v) : [""],
      restartStrategy: process.restart_policy.strategy,
      maxRetries:
        process.restart_policy.max_retries === null
          ? ""
          : String(process.restart_policy.max_retries),
      delayMs: String(process.restart_policy.delay_ms),
      backoffMultiplier: String(process.restart_policy.backoff_multiplier),
      autoStart: process.auto_start,
      groupName: process.group_name ?? "",
      logMaxFileSize: String(process.log_config.max_file_size / (1024 * 1024)),
      logMaxFiles: String(process.log_config.max_files),
      runAs: process.run_as ?? "",
    });
    setStep(0);
    setError(null);
    setIsSubmitting(false);
  }, [open, process?.id]);

  const updateForm = (field: keyof CreateFormState, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const addEnvVar = () => {
    setForm((f) => ({
      ...f,
      envKeys: [...f.envKeys, ""],
      envValues: [...f.envValues, ""],
    }));
  };

  const removeEnvVar = (index: number) => {
    setForm((f) => ({
      ...f,
      envKeys: f.envKeys.filter((_, i) => i !== index),
      envValues: f.envValues.filter((_, i) => i !== index),
    }));
  };

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.name.trim()) return "Name is required";
      if (!form.command.trim()) return "Command is required";
    }
    if (s === 1) {
      if (form.maxRetries && isNaN(Number(form.maxRetries))) return "Max retries must be a number";
      if (form.delayMs && isNaN(Number(form.delayMs))) return "Delay must be a number";
      if (form.backoffMultiplier && isNaN(Number(form.backoffMultiplier)))
        return "Backoff multiplier must be a number";
    }
    return null;
  };

  const nextStep = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, wizardSteps.length - 1));
  };

  const prevStep = () => {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const buildDiffRequest = (target: ProcessInfo): { req: UpdateProcessRequest; willRestart: boolean } => {
    const nextEnv = buildEnvFromForm(form);
    const nextArgs = splitArgs(form.args);
    const nextCwd = form.cwd.trim() || ".";
    const nextGroupName = form.groupName.trim() || null;
    const nextRunAs = isWindows ? target.run_as : (form.runAs.trim() || null);
    const nextRestartPolicy = {
      strategy: form.restartStrategy,
      max_retries: form.maxRetries ? Number(form.maxRetries) : null,
      delay_ms: Number(form.delayMs) || 1000,
      backoff_multiplier: Number(form.backoffMultiplier) || 2.0,
    } as const;
    const nextLogConfig = {
      max_file_size: (Number(form.logMaxFileSize) || 10) * 1024 * 1024,
      max_files: Number(form.logMaxFiles) || 5,
    } as const;

    const req: UpdateProcessRequest = { id: target.id };

    if (form.name.trim() !== target.name) req.name = form.name.trim();
    if (form.command.trim() !== target.command) req.command = form.command.trim();
    if (
      nextArgs.length !== target.args.length ||
      nextArgs.some((arg, i) => arg !== target.args[i])
    ) {
      req.args = nextArgs;
    }
    if (nextCwd !== target.cwd) req.cwd = nextCwd;

    const targetEnvEntries = Object.entries(target.env).sort(([a], [b]) => a.localeCompare(b));
    const nextEnvEntries = Object.entries(nextEnv).sort(([a], [b]) => a.localeCompare(b));
    const envChanged =
      targetEnvEntries.length !== nextEnvEntries.length ||
      targetEnvEntries.some(([k, v], i) => {
        const [nextK, nextV] = nextEnvEntries[i] ?? [];
        return k !== nextK || v !== nextV;
      });
    if (envChanged) req.env = nextEnv;

    if (
      target.restart_policy.strategy !== nextRestartPolicy.strategy ||
      target.restart_policy.max_retries !== nextRestartPolicy.max_retries ||
      target.restart_policy.delay_ms !== nextRestartPolicy.delay_ms ||
      target.restart_policy.backoff_multiplier !== nextRestartPolicy.backoff_multiplier
    ) {
      req.restart_policy = {
        strategy: nextRestartPolicy.strategy,
        max_retries: nextRestartPolicy.max_retries,
        delay_ms: nextRestartPolicy.delay_ms,
        backoff_multiplier: nextRestartPolicy.backoff_multiplier,
      };
    }

    if (target.auto_start !== form.autoStart) req.auto_start = form.autoStart;
    if (target.group_name !== nextGroupName) req.group_name = nextGroupName;

    if (
      target.log_config.max_file_size !== nextLogConfig.max_file_size ||
      target.log_config.max_files !== nextLogConfig.max_files
    ) {
      req.log_config = {
        max_file_size: nextLogConfig.max_file_size,
        max_files: nextLogConfig.max_files,
      };
    }

    if (!isWindows && target.run_as !== nextRunAs) req.run_as = nextRunAs;

    const willRestart = target.status === "running" && (
      req.command !== undefined ||
      req.args !== undefined ||
      req.cwd !== undefined ||
      req.env !== undefined ||
      req.run_as !== undefined
    );

    return { req, willRestart };
  };

  const hasChanges = process ? Object.keys(buildDiffRequest(process).req).length > 1 : false;
  const willRestart = process ? buildDiffRequest(process).willRestart : false;

  const handleSubmit = async () => {
    if (!process) return;

    for (let s = 0; s < wizardSteps.length; s++) {
      const err = validateStep(s);
      if (err) {
        setError(err);
        setStep(s);
        return;
      }
    }

    const { req } = buildDiffRequest(process);
    if (Object.keys(req).length <= 1) {
      onOpenChange(false);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await updateProcess(req);
      onOpenChange(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update process");
    } finally {
      setIsSubmitting(false);
    }
  };

  const BasicSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="edit-proc-name">Name *</Label>
        <Input
          id="edit-proc-name"
          value={form.name}
          onChange={(e) => updateForm("name", e.target.value)}
          placeholder="my-app"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-proc-command">Command *</Label>
        <Input
          id="edit-proc-command"
          value={form.command}
          onChange={(e) => updateForm("command", e.target.value)}
          placeholder="node"
          className="font-mono"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-proc-args">Arguments</Label>
        <Input
          id="edit-proc-args"
          value={form.args}
          onChange={(e) => updateForm("args", e.target.value)}
          placeholder="server.js --port 3000"
          className="font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-proc-cwd">Working Directory</Label>
        <Input
          id="edit-proc-cwd"
          value={form.cwd}
          onChange={(e) => updateForm("cwd", e.target.value)}
          placeholder="/home/user/app"
          className="font-mono"
        />
      </div>
    </div>
  );

  const RestartSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Restart Strategy</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["on_failure", "always", "never"] as const).map((strategy) => (
            <button
              key={strategy}
              type="button"
              onClick={() => updateForm("restartStrategy", strategy)}
              className={`rounded-lg border px-3 py-2.5 text-sm transition-all ${
                form.restartStrategy === strategy
                  ? "border-primary bg-primary/5 text-primary font-medium ring-1 ring-primary/20"
                  : "hover:bg-muted/50"
              }`}
            >
              {strategy === "on_failure"
                ? "On Failure"
                : strategy === "always"
                ? "Always"
                : "Never"}
            </button>
          ))}
        </div>
      </div>

      {form.restartStrategy !== "never" && (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-proc-retries">Max Retries</Label>
            <Input
              id="edit-proc-retries"
              type="number"
              min="0"
              value={form.maxRetries}
              onChange={(e) => updateForm("maxRetries", e.target.value)}
              placeholder="10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-proc-delay">Delay (ms)</Label>
            <Input
              id="edit-proc-delay"
              type="number"
              min="1"
              value={form.delayMs}
              onChange={(e) => updateForm("delayMs", e.target.value)}
              placeholder="1000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-proc-backoff">Backoff ×</Label>
            <Input
              id="edit-proc-backoff"
              type="number"
              min="1"
              step="0.1"
              value={form.backoffMultiplier}
              onChange={(e) => updateForm("backoffMultiplier", e.target.value)}
              placeholder="2.0"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-lg border p-3">
        <input
          type="checkbox"
          id="edit-proc-autostart"
          checked={form.autoStart}
          onChange={(e) => updateForm("autoStart", e.target.checked)}
          className="size-4 rounded"
        />
        <div>
          <Label htmlFor="edit-proc-autostart" className="cursor-pointer">Auto Start</Label>
          <p className="text-xs text-muted-foreground">
            Automatically start this process when the daemon starts.
          </p>
        </div>
      </div>
    </div>
  );

  const AdvancedSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="edit-proc-group">Group Name</Label>
        <Input
          id="edit-proc-group"
          value={form.groupName}
          onChange={(e) => updateForm("groupName", e.target.value)}
          placeholder="web-services"
        />
      </div>

      {!isWindows && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="edit-proc-runas">Run As User</Label>
            <Badge variant="outline" className="text-[10px]">Unix Only</Badge>
          </div>
          <Input
            id="edit-proc-runas"
            value={form.runAs}
            onChange={(e) => updateForm("runAs", e.target.value)}
            placeholder="www-data"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Username or UID. Requires root privileges. Ignored if not root.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label>Log Rotation</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="edit-proc-logsize" className="text-xs text-muted-foreground">
              Max File Size (MB)
            </Label>
            <Input
              id="edit-proc-logsize"
              type="number"
              min="1"
              value={form.logMaxFileSize}
              onChange={(e) => updateForm("logMaxFileSize", e.target.value)}
              placeholder="10"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-proc-logfiles" className="text-xs text-muted-foreground">
              Rotated Files to Keep
            </Label>
            <Input
              id="edit-proc-logfiles"
              type="number"
              min="1"
              value={form.logMaxFiles}
              onChange={(e) => updateForm("logMaxFiles", e.target.value)}
              placeholder="5"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Environment Variables</Label>
          <Button type="button" variant="outline" size="sm" onClick={addEnvVar} className="h-7 text-xs">
            <Plus className="mr-1 size-3" />
            Add
          </Button>
        </div>
        <div className="space-y-2">
          {form.envKeys.map((key, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={key}
                onChange={(e) => {
                  const k = [...form.envKeys];
                  k[i] = e.target.value;
                  updateForm("envKeys", k);
                }}
                placeholder="KEY"
                className="font-mono flex-1"
              />
              <span className="text-muted-foreground">=</span>
              <Input
                value={form.envValues[i] ?? ""}
                onChange={(e) => {
                  const v = [...form.envValues];
                  v[i] = e.target.value;
                  updateForm("envValues", v);
                }}
                placeholder="value"
                className="font-mono flex-1"
              />
              {form.envKeys.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => removeEnvVar(i)}
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <ResponsiveModalContent className="md:max-w-xl">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Edit Process</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Update process configuration. Only changed fields will be saved.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="px-4 md:px-0">
          <StepIndicator steps={wizardSteps} current={step} />

          {process?.status === "running" && (
            <div
              className={`mb-4 rounded-md px-3 py-2 text-sm ${
                willRestart
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {willRestart
                ? "This update will restart the running process (launch parameters changed)."
                : "This update will be applied without restart."}
            </div>
          )}

          {!hasChanges && (
            <div className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              No changes detected yet.
            </div>
          )}

          <div className="min-h-[250px]">
            {step === 0 && BasicSection}
            {step === 1 && RestartSection}
            {step === 2 && AdvancedSection}
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <ResponsiveModalFooter className="gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={prevStep} disabled={isSubmitting}>
              <ChevronLeft className="mr-1 size-4" />
              Back
            </Button>
          )}
          <div className="flex-1" />
          {step < wizardSteps.length - 1 ? (
            <Button type="button" onClick={nextStep} disabled={isSubmitting}>
              Next
              <ChevronRight className="ml-1 size-4" />
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save Changes
            </Button>
          )}
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

// ── Log Viewer ──────────────────────────────────────────────────

function LogViewer({
  processId,
  processName,
  onClose,
}: {
  processId: string;
  processName: string;
  onClose: () => void;
}) {
  const { fetchLogs } = useProcessStore();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [streamFilter, setStreamFilter] = useState<"all" | "stdout" | "stderr">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Load historical logs
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLogs(processId, { stream: streamFilter, lines: 500 });
      setLogs(res.lines);
      setHasMore(res.has_more);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchLogs, processId, streamFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Subscribe to real-time log events
  useEffect(() => {
    const rpc = getRpcClient();
    const unsub = rpc.on("event.process.log", (params: unknown) => {
      const data = params as { process_id: string; stream: string; line: string };
      if (data.process_id !== processId) return;
      if (streamFilter !== "all" && data.stream !== streamFilter) return;

      setLogs((prev) => [
        ...prev,
        { stream: data.stream, line: data.line, timestamp: new Date().toISOString() },
      ]);
    });

    return unsub;
  }, [processId, streamFilter]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const handleDownload = () => {
    const content = logs.map((l) => `[${l.stream}] ${l.line}`).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${processName}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadMore = async () => {
    try {
      const res = await fetchLogs(processId, {
        stream: streamFilter,
        lines: 500,
        offset: logs.length,
      });
      setLogs((prev) => [...res.lines, ...prev]);
      setHasMore(res.has_more);
    } catch (err) {
      console.error("Failed to load more logs:", err);
    }
  };

  const filteredLogs = logs;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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
          {/* Stream filter */}
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
            {(["all", "stdout", "stderr"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStreamFilter(s)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-all ${
                  streamFilter === s
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>

          {/* Auto-scroll toggle */}
          <Button
            variant={autoScroll ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            {autoScroll ? <ArrowDown className="mr-1 size-3" /> : <Pause className="mr-1 size-3" />}
            {autoScroll ? "Auto" : "Paused"}
          </Button>

          {/* Download */}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleDownload}>
            <Download className="mr-1 size-3" />
            Export
          </Button>
        </div>
      </div>

      {/* Log content */}
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
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ScrollText className="size-8 mb-2 opacity-50" />
            <p>No logs available</p>
            <p className="text-xs mt-1">Logs will appear here when the process runs.</p>
          </div>
        ) : (
          <div className="p-3">
            {hasMore && (
              <button
                onClick={loadMore}
                className="mb-2 w-full rounded-md bg-muted/50 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                Load earlier logs…
              </button>
            )}
            {filteredLogs.map((log, i) => (
              <div
                key={i}
                className={`flex gap-2 py-px hover:bg-muted/30 rounded-sm px-1 ${
                  log.stream === "stderr" ? "text-red-400" : "text-foreground/90"
                }`}
              >
                <span
                  className={`shrink-0 select-none text-[10px] w-10 text-right ${
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

  const [viewingLogs, setViewingLogs] = useState<string | null>(null);
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);

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
        case "edit":
          setEditingProcessId(id);
          break;
        case "delete":
          await deleteProcess(id);
          break;
      }
    } catch (err) {
      console.error(`Failed to ${action} process:`, err);
    }
  };

  const logProcess = viewingLogs
    ? processes.find((p) => p.id === viewingLogs)
    : null;
  const editingProcess = editingProcessId
    ? processes.find((p) => p.id === editingProcessId) ?? null
    : null;

  // If viewing logs, show full-screen log viewer
  if (viewingLogs && logProcess) {
    return (
      <>
        <AppHeader title="Process Logs" />
        <div className="flex-1 overflow-hidden">
          <LogViewer
            processId={viewingLogs}
            processName={logProcess.name}
            onClose={() => setViewingLogs(null)}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader title="Processes" />
      <EditProcessDialog
        process={editingProcess}
        open={Boolean(editingProcessId && editingProcess)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProcessId(null);
          }
        }}
        onUpdated={fetchProcesses}
      />
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
                  onViewLogs={setViewingLogs}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
