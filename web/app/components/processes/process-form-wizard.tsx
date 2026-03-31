import { useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cog,
  Layers,
  Loader2,
  Monitor,
  Play,
  Plus,
  Repeat,
  Shield,
  Terminal,
  Timer,
  X,
} from "lucide-react";

import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "~/components/ui/combobox";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { PathPicker } from "~/components/path-picker";
import { ResponsiveModalFooter } from "~/components/responsive-modal";
import type { ProcessMode, ScheduleOverlapPolicy, ScheduleType, Weekday } from "~/stores/process-store";

import { type ProcessFormState, type FormTab, formTabs } from "./process-form-state";

// ── Tab definitions with icons ──────────────────────────────────

const tabMeta: Record<FormTab, { icon: typeof Cog; label: string }> = {
  General: { icon: Cog, label: "General" },
  Execution: { icon: Play, label: "Execution" },
  Behavior: { icon: Repeat, label: "Behavior" },
  System: { icon: Monitor, label: "System" },
};

// ── Main tabbed form ────────────────────────────────────────────

export function ProcessFormTabs({
  form,
  activeTab,
  onTabChange,
  isWindows,
  idPrefix,
  existingGroups,
  updateForm,
  addEnvVar,
  removeEnvVar,
  wizardMode,
}: {
  form: ProcessFormState;
  activeTab: FormTab;
  onTabChange: (tab: FormTab) => void;
  isWindows: boolean;
  idPrefix: string;
  existingGroups?: string[];
  updateForm: (field: keyof ProcessFormState, value: unknown) => void;
  addEnvVar: () => void;
  removeEnvVar: (index: number) => void;
  /** When true, tabs act as step indicators and cannot be freely clicked. */
  wizardMode?: boolean;
}) {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const activeIndex = formTabs.indexOf(activeTab);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => {
        if (!wizardMode) onTabChange(v as FormTab);
      }}
      className="w-full"
    >
      <TabsList className="w-full">
        {formTabs.map((tab, i) => {
          const { icon: Icon, label } = tabMeta[tab];
          return (
            <TabsTrigger
              key={tab}
              value={tab}
              className="gap-1.5"
              disabled={wizardMode && i !== activeIndex}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>

      {/* ── Tab 1: General ─────────────────────────── */}
      <TabsContent value="General" className="mt-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Process Mode</Label>
            <div className="grid grid-cols-2 gap-3">
              {([
                { value: "daemon" as ProcessMode, label: "Daemon", icon: Shield, desc: "Long-running process with auto-restart" },
                { value: "schedule" as ProcessMode, label: "Scheduled Task", icon: Calendar, desc: "Run on a schedule or at specific times" },
              ]).map(({ value, label, icon: Icon, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateForm("mode", value)}
                  className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all ${
                    form.mode === value
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`size-4 ${form.mode === value ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-sm font-medium ${form.mode === value ? "text-primary" : ""}`}>
                      {label}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={fieldId("name")}>Name *</Label>
            <Input
              id={fieldId("name")}
              value={form.name}
              onChange={(e) => updateForm("name", e.target.value)}
              placeholder={form.mode === "schedule" ? "backup-job" : "my-app"}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fieldId("group")}>Group</Label>
            <Combobox
              items={existingGroups ?? []}
              inputValue={form.groupName}
              onValueChange={(val) => updateForm("groupName", val ?? "")}
              onInputValueChange={(val) => updateForm("groupName", val)}
              filter={(item, query) =>
                String(item).toLowerCase().includes(query.toLowerCase())
              }
            >
              <ComboboxInput
                id={fieldId("group")}
                placeholder="web-services"
                showClear={Boolean(form.groupName)}
                className="w-full overflow-hidden"
              />
              <ComboboxContent>
                <ComboboxList>
                  <ComboboxCollection>
                    {(g: string) => (
                      <ComboboxItem key={g} value={g}>
                        {g}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                  <ComboboxEmpty>No matching groups</ComboboxEmpty>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <p className="text-xs text-muted-foreground">
              Type a new group or select an existing one.
            </p>
          </div>
        </div>
      </TabsContent>

      {/* ── Tab 2: Execution ───────────────────────── */}
      <TabsContent value="Execution" className="mt-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={fieldId("command")}>Command *</Label>
            <PathPicker
              id={fieldId("command")}
              value={form.command}
              onChange={(v) => updateForm("command", v)}
              mode="file"
              placeholder={form.mode === "schedule" ? "/usr/local/bin/backup.sh" : "node"}
            />
            <p className="text-xs text-muted-foreground">
              Executable or command to run. Must exist in PATH or be an absolute path.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={fieldId("args")}>Arguments</Label>
            <Input
              id={fieldId("args")}
              value={form.args}
              onChange={(e) => updateForm("args", e.target.value)}
              placeholder="server.js --port 3000"
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fieldId("cwd")}>Working Directory</Label>
            <PathPicker
              id={fieldId("cwd")}
              value={form.cwd}
              onChange={(v) => updateForm("cwd", v)}
              mode="directory"
              placeholder="/home/user/app"
            />
          </div>

          {!isWindows && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={fieldId("runas")}>Run As User</Label>
                <Badge variant="outline" className="text-[10px]">
                  Unix Only
                </Badge>
              </div>
              <Input
                id={fieldId("runas")}
                value={form.runAs}
                onChange={(e) => updateForm("runAs", e.target.value)}
                placeholder="www-data"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Username or UID. Requires root privileges.
              </p>
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Environment Variables</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addEnvVar}
                className="h-7 text-xs"
              >
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
                      const keys = [...form.envKeys];
                      keys[i] = e.target.value;
                      updateForm("envKeys", keys);
                    }}
                    placeholder="KEY"
                    className="font-mono flex-1"
                  />
                  <span className="text-muted-foreground">=</span>
                  <Input
                    value={form.envValues[i] ?? ""}
                    onChange={(e) => {
                      const values = [...form.envValues];
                      values[i] = e.target.value;
                      updateForm("envValues", values);
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
      </TabsContent>

      {/* ── Tab 3: Behavior ────────────────────────── */}
      <TabsContent value="Behavior" className="mt-4">
        {form.mode === "schedule" ? (
          <ScheduleBehaviorSection form={form} updateForm={updateForm} fieldId={fieldId} />
        ) : (
          <DaemonBehaviorSection form={form} updateForm={updateForm} fieldId={fieldId} />
        )}
      </TabsContent>

      {/* ── Tab 4: System ──────────────────────────── */}
      <TabsContent value="System" className="mt-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={fieldId("instances")}>Instance Count</Label>
              <Badge variant="outline" className="text-[10px]">
                <Layers className="mr-1 size-3" />
                Multi-Instance
              </Badge>
            </div>
            <Input
              id={fieldId("instances")}
              type="number"
              min="1"
              max="100"
              value={form.instanceCount}
              onChange={(e) => updateForm("instanceCount", e.target.value)}
              placeholder="1"
            />
            <p className="text-xs text-muted-foreground">
              Number of instances to run (1–100). Each gets independent supervision and logs.
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Terminal className="size-4 text-muted-foreground" />
              <div>
                <Label htmlFor={fieldId("ptymode")} className="cursor-pointer">
                  PTY Mode
                </Label>
                <p className="text-xs text-muted-foreground">
                  Run in a pseudo-terminal for interactive processes.
                </p>
              </div>
            </div>
            <Switch
              id={fieldId("ptymode")}
              checked={form.ptyMode}
              onCheckedChange={(checked) => updateForm("ptyMode", checked)}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Log Rotation</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor={fieldId("logsize")} className="text-xs text-muted-foreground">
                  Max File Size (MB)
                </Label>
                <Input
                  id={fieldId("logsize")}
                  type="number"
                  min="1"
                  value={form.logMaxFileSize}
                  onChange={(e) => updateForm("logMaxFileSize", e.target.value)}
                  placeholder="10"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={fieldId("logfiles")} className="text-xs text-muted-foreground">
                  Rotated Files to Keep
                </Label>
                <Input
                  id={fieldId("logfiles")}
                  type="number"
                  min="1"
                  value={form.logMaxFiles}
                  onChange={(e) => updateForm("logMaxFiles", e.target.value)}
                  placeholder="5"
                />
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

// ── Daemon behavior (restart policy + enabled) ──────────────────

function DaemonBehaviorSection({
  form,
  updateForm,
  fieldId,
}: {
  form: ProcessFormState;
  updateForm: (field: keyof ProcessFormState, value: unknown) => void;
  fieldId: (field: string) => string;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label htmlFor={fieldId("autostart")} className="cursor-pointer">
            Enabled
          </Label>
          <p className="text-xs text-muted-foreground">
            Automatically start when the daemon starts.
          </p>
        </div>
        <Switch
          id={fieldId("autostart")}
          checked={form.autoStart}
          onCheckedChange={(checked) => updateForm("autoStart", checked)}
        />
      </div>

      <Separator />

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
              {strategy === "on_failure" ? "On Failure" : strategy === "always" ? "Always" : "Never"}
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
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <ChevronDown className={`size-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              Advanced Retry Settings
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor={fieldId("retries")}>Max Retries</Label>
                <Input
                  id={fieldId("retries")}
                  type="number"
                  min="0"
                  value={form.maxRetries}
                  onChange={(e) => updateForm("maxRetries", e.target.value)}
                  placeholder="10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={fieldId("delay")}>Delay (ms)</Label>
                <Input
                  id={fieldId("delay")}
                  type="number"
                  min="1"
                  value={form.delayMs}
                  onChange={(e) => updateForm("delayMs", e.target.value)}
                  placeholder="1000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={fieldId("backoff")}>Backoff &times;</Label>
                <Input
                  id={fieldId("backoff")}
                  type="number"
                  min="1"
                  step="0.1"
                  value={form.backoffMultiplier}
                  onChange={(e) => updateForm("backoffMultiplier", e.target.value)}
                  placeholder="2.0"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ── Schedule behavior ───────────────────────────────────────────

const allWeekdays: { value: Weekday; label: string; short: string }[] = [
  { value: "monday", label: "Monday", short: "Mon" },
  { value: "tuesday", label: "Tuesday", short: "Tue" },
  { value: "wednesday", label: "Wednesday", short: "Wed" },
  { value: "thursday", label: "Thursday", short: "Thu" },
  { value: "friday", label: "Friday", short: "Fri" },
  { value: "saturday", label: "Saturday", short: "Sat" },
  { value: "sunday", label: "Sunday", short: "Sun" },
];

const scheduleTypeOptions: { value: ScheduleType; label: string; icon: typeof Clock; desc: string }[] = [
  { value: "once", label: "Once", icon: Clock, desc: "Run once at a specific time" },
  { value: "daily", label: "Daily", icon: Repeat, desc: "Run at a fixed time every day" },
  { value: "weekly", label: "Weekly", icon: Calendar, desc: "Run on selected weekdays" },
  { value: "interval", label: "Interval", icon: Timer, desc: "Run every N seconds" },
];

const overlapPolicyOptions: { value: ScheduleOverlapPolicy; label: string; desc: string }[] = [
  { value: "ignore", label: "Skip", desc: "Skip this trigger if still running" },
  { value: "restart", label: "Restart", desc: "Stop the old run, start a new one" },
  { value: "start_new", label: "Start New", desc: "Keep old running, start another" },
];

function ScheduleBehaviorSection({
  form,
  updateForm,
  fieldId,
}: {
  form: ProcessFormState;
  updateForm: (field: keyof ProcessFormState, value: unknown) => void;
  fieldId: (field: string) => string;
}) {
  const toggleWeekday = (day: Weekday) => {
    const current = form.scheduleWeekdays;
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    updateForm("scheduleWeekdays", next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label htmlFor={fieldId("autostart-schedule")} className="cursor-pointer">
            Enable Schedule
          </Label>
          <p className="text-xs text-muted-foreground">
            Automatically activate this schedule when the daemon starts.
          </p>
        </div>
        <Switch
          id={fieldId("autostart-schedule")}
          checked={form.autoStart}
          onCheckedChange={(checked) => updateForm("autoStart", checked)}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Schedule Type</Label>
        <div className="grid grid-cols-2 gap-2">
          {scheduleTypeOptions.map(({ value, label, icon: Icon, desc }) => (
            <button
              key={value}
              type="button"
              onClick={() => updateForm("scheduleType", value)}
              className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-all ${
                form.scheduleType === value
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`size-3.5 ${form.scheduleType === value ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`text-sm font-medium ${form.scheduleType === value ? "text-primary" : ""}`}>
                  {label}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {form.scheduleType === "once" && (
        <div className="space-y-2">
          <Label htmlFor={fieldId("run-at")}>Run At *</Label>
          <Input
            id={fieldId("run-at")}
            type="datetime-local"
            value={form.scheduleRunAt ? form.scheduleRunAt.slice(0, 16) : ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                const date = new Date(val);
                updateForm("scheduleRunAt", date.toISOString());
              } else {
                updateForm("scheduleRunAt", "");
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            The exact date and time to run this task once.
          </p>
        </div>
      )}

      {(form.scheduleType === "daily" || form.scheduleType === "weekly") && (
        <div className="space-y-4">
          {form.scheduleType === "weekly" && (
            <div className="space-y-2">
              <Label>Weekdays *</Label>
              <div className="flex flex-wrap gap-1.5">
                {allWeekdays.map(({ value, short }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleWeekday(value)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all ${
                      form.scheduleWeekdays.includes(value)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    {short}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Time</Label>
            <div className="flex items-center gap-2">
              <div className="space-y-1 flex-1">
                <Label htmlFor={fieldId("hour")} className="text-xs text-muted-foreground">
                  Hour (0–23)
                </Label>
                <Input
                  id={fieldId("hour")}
                  type="number"
                  min="0"
                  max="23"
                  value={form.scheduleHour}
                  onChange={(e) => updateForm("scheduleHour", e.target.value)}
                  placeholder="9"
                />
              </div>
              <span className="mt-5 text-lg font-medium text-muted-foreground">:</span>
              <div className="space-y-1 flex-1">
                <Label htmlFor={fieldId("minute")} className="text-xs text-muted-foreground">
                  Minute (0–59)
                </Label>
                <Input
                  id={fieldId("minute")}
                  type="number"
                  min="0"
                  max="59"
                  value={form.scheduleMinute}
                  onChange={(e) => updateForm("scheduleMinute", e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Time is interpreted in the daemon's local timezone.
            </p>
          </div>
        </div>
      )}

      {form.scheduleType === "interval" && (
        <div className="space-y-2">
          <Label htmlFor={fieldId("interval")}>Interval (seconds) *</Label>
          <Input
            id={fieldId("interval")}
            type="number"
            min="1"
            value={form.scheduleEverySeconds}
            onChange={(e) => updateForm("scheduleEverySeconds", e.target.value)}
            placeholder="300"
          />
          <p className="text-xs text-muted-foreground">
            {Number(form.scheduleEverySeconds) >= 60
              ? `Every ${Math.floor(Number(form.scheduleEverySeconds) / 60)} min${Number(form.scheduleEverySeconds) % 60 > 0 ? ` ${Number(form.scheduleEverySeconds) % 60} sec` : ""}`
              : `Every ${form.scheduleEverySeconds || 0} seconds`}
          </p>
        </div>
      )}

      <Separator />

      <div className="space-y-2">
        <Label>Overlap Policy</Label>
        <div className="grid grid-cols-3 gap-2">
          {overlapPolicyOptions.map(({ value, label, desc }) => (
            <button
              key={value}
              type="button"
              onClick={() => updateForm("scheduleOverlapPolicy", value)}
              className={`flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-all ${
                form.scheduleOverlapPolicy === value
                  ? "border-primary bg-primary/5 text-primary font-medium ring-1 ring-primary/20"
                  : "hover:bg-muted/50"
              }`}
            >
              <span className="text-sm">{label}</span>
              <span className="text-[11px] text-muted-foreground font-normal">{desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Backward-compat exports (kept for legacy 3-step wizard) ─────

/** @deprecated Use ProcessFormTabs instead */
export function StepIndicator({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {steps.map((step, i) => (
        <div key={step} className="flex flex-1 items-center gap-2">
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
            className={`hidden truncate text-xs sm:block ${
              i <= current ? "font-medium text-foreground" : "text-muted-foreground"
            }`}
          >
            {step}
          </span>
          {i < steps.length - 1 && (
            <div className={`h-px flex-1 ${i < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/** @deprecated Use ProcessFormTabs instead */
export function ProcessFormSections({
  form,
  step,
  isWindows,
  idPrefix,
  existingGroups,
  updateForm,
  addEnvVar,
  removeEnvVar,
}: {
  form: ProcessFormState;
  step: number;
  isWindows: boolean;
  idPrefix: string;
  existingGroups?: string[];
  updateForm: (field: keyof ProcessFormState, value: unknown) => void;
  addEnvVar: () => void;
  removeEnvVar: (index: number) => void;
}) {
  const tabIndex = Math.min(step, formTabs.length - 1);
  return (
    <ProcessFormTabs
      form={form}
      activeTab={formTabs[tabIndex]}
      onTabChange={() => {}}
      isWindows={isWindows}
      idPrefix={idPrefix}
      existingGroups={existingGroups}
      updateForm={updateForm}
      addEnvVar={addEnvVar}
      removeEnvVar={removeEnvVar}
    />
  );
}

// ── Footer ──────────────────────────────────────────────────────

export function TabFormFooter({
  isSubmitting,
  submitLabel,
  onSubmit,
}: {
  isSubmitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
}) {
  return (
    <ResponsiveModalFooter className="gap-2">
      <div className="flex-1" />
      <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
        {submitLabel}
      </Button>
    </ResponsiveModalFooter>
  );
}

export function WizardFormFooter({
  step,
  totalSteps,
  isSubmitting,
  submitLabel,
  onBack,
  onNext,
  onSubmit,
}: {
  step: number;
  totalSteps: number;
  isSubmitting: boolean;
  submitLabel: string;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  const isLast = step >= totalSteps - 1;
  return (
    <ResponsiveModalFooter className="gap-2">
      {step > 0 && (
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
      )}
      <div className="flex-1" />
      {isLast ? (
        <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          {submitLabel}
        </Button>
      ) : (
        <Button type="button" onClick={onNext} disabled={isSubmitting}>
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      )}
    </ResponsiveModalFooter>
  );
}
