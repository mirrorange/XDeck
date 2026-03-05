import {
  getAggregateStatus,
  type CreateProcessRequest,
  type ProcessInfo,
  type UpdateProcessRequest,
} from "~/stores/process-store";

export const wizardSteps = ["Basic Info", "Restart Policy", "Advanced"];

export interface ProcessFormState {
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
  instanceCount: string;
}

export const defaultForm: ProcessFormState = {
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
  instanceCount: "1",
};

function buildEnvFromForm(form: ProcessFormState): Record<string, string> {
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

export function validateProcessFormStep(form: ProcessFormState, step: number): string | null {
  if (step === 0) {
    if (!form.name.trim()) return "Name is required";
    if (!form.command.trim()) return "Command is required";
  }

  if (step === 1) {
    if (form.maxRetries && Number.isNaN(Number(form.maxRetries))) return "Max retries must be a number";
    if (form.delayMs && Number.isNaN(Number(form.delayMs))) return "Delay must be a number";
    if (form.backoffMultiplier && Number.isNaN(Number(form.backoffMultiplier))) {
      return "Backoff multiplier must be a number";
    }
  }

  return null;
}

export function buildCreateRequest(form: ProcessFormState, isWindows: boolean): CreateProcessRequest {
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
    instance_count: Math.max(1, Math.min(100, Number(form.instanceCount) || 1)),
  };
}

export function buildEditRequestDiff(
  target: ProcessInfo,
  form: ProcessFormState,
  isWindows: boolean
): { req: UpdateProcessRequest; hasChanges: boolean; willRestart: boolean } {
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
  if (nextArgs.length !== target.args.length || nextArgs.some((arg, i) => arg !== target.args[i])) {
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

  const nextInstanceCount = Math.max(1, Math.min(100, Number(form.instanceCount) || 1));
  if (target.instance_count !== nextInstanceCount) req.instance_count = nextInstanceCount;

  const willRestart =
    getAggregateStatus(target.instances) === "running" &&
    (req.command !== undefined ||
      req.args !== undefined ||
      req.cwd !== undefined ||
      req.env !== undefined ||
      req.run_as !== undefined ||
      req.instance_count !== undefined);

  return { req, hasChanges: Object.keys(req).length > 1, willRestart };
}

export function toFormState(process: ProcessInfo): ProcessFormState {
  const envEntries = Object.entries(process.env);
  return {
    name: process.name,
    command: process.command,
    args: process.args.join(" "),
    cwd: process.cwd,
    envKeys: envEntries.length > 0 ? envEntries.map(([k]) => k) : [""],
    envValues: envEntries.length > 0 ? envEntries.map(([, v]) => v) : [""],
    restartStrategy: process.restart_policy.strategy,
    maxRetries: process.restart_policy.max_retries === null ? "" : String(process.restart_policy.max_retries),
    delayMs: String(process.restart_policy.delay_ms),
    backoffMultiplier: String(process.restart_policy.backoff_multiplier),
    autoStart: process.auto_start,
    groupName: process.group_name ?? "",
    logMaxFileSize: String(process.log_config.max_file_size / (1024 * 1024)),
    logMaxFiles: String(process.log_config.max_files),
    runAs: process.run_as ?? "",
    instanceCount: String(process.instance_count),
  };
}
