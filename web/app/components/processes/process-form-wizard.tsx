import { ChevronLeft, ChevronRight, Layers, Loader2, Plus, X } from "lucide-react";

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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ResponsiveModalFooter } from "~/components/responsive-modal";

import { type ProcessFormState, wizardSteps } from "./process-form-state";

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
  const fieldId = (field: string) => `${idPrefix}-${field}`;

  if (step === 0) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={fieldId("name")}>Name *</Label>
          <Input
            id={fieldId("name")}
            value={form.name}
            onChange={(e) => updateForm("name", e.target.value)}
            placeholder="my-app"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={fieldId("command")}>Command *</Label>
          <Input
            id={fieldId("command")}
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
          <Input
            id={fieldId("cwd")}
            value={form.cwd}
            onChange={(e) => updateForm("cwd", e.target.value)}
            placeholder="/home/user/app"
            className="font-mono"
          />
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
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
              <Label htmlFor={fieldId("backoff")}>Backoff ×</Label>
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
        )}

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            id={fieldId("autostart")}
            checked={form.autoStart}
            onChange={(e) => updateForm("autoStart", e.target.checked)}
            className="size-4 rounded"
          />
          <div>
            <Label htmlFor={fieldId("autostart")} className="cursor-pointer">
              Auto Start
            </Label>
            <p className="text-xs text-muted-foreground">
              Automatically start this process when the daemon starts.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const groupSuggestions = existingGroups ?? [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={fieldId("group")}>Group Name</Label>
        <Combobox
          items={groupSuggestions}
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
          className="w-24"
        />
        <p className="text-xs text-muted-foreground">
          Number of instances to run (1–100). Each gets independent supervision and logs.
        </p>
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
            Username or UID. Requires root privileges. Ignored if not root.
          </p>
        </div>
      )}

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
  );
}

export function WizardFooter({
  step,
  isSubmitting,
  submitLabel,
  onBack,
  onNext,
  onSubmit,
}: {
  step: number;
  isSubmitting: boolean;
  submitLabel: string;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  return (
    <ResponsiveModalFooter className="gap-2">
      {step > 0 && (
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
      )}
      <div className="flex-1" />
      {step < wizardSteps.length - 1 ? (
        <Button type="button" onClick={onNext} disabled={isSubmitting}>
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      ) : (
        <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          {submitLabel}
        </Button>
      )}
    </ResponsiveModalFooter>
  );
}
