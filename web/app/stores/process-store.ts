import { create } from "zustand";
import { getRpcClient } from "~/lib/rpc-client";

// -- Types -------------------------------------------------------

export type ProcessStatus =
  | "created"
  | "starting"
  | "running"
  | "stopped"
  | "errored"
  | "failed";

export type RestartStrategy = "always" | "on_failure" | "never";

export interface RestartPolicy {
  strategy: RestartStrategy;
  max_retries: number | null;
  delay_ms: number;
  backoff_multiplier: number;
}

export interface ProcessLogConfig {
  max_file_size: number;
  max_files: number;
}

export interface InstanceInfo {
  index: number;
  status: ProcessStatus;
  pid: number | null;
  pty_session_id: string | null;
  restart_count: number;
  started_at: string | null;
  exit_code: number | null;
}

export interface ProcessInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  restart_policy: RestartPolicy;
  auto_start: boolean;
  group_name: string | null;
  log_config: ProcessLogConfig;
  run_as: string | null;
  instance_count: number;
  pty_mode: boolean;
  created_at: string;
  updated_at: string;
  instances: InstanceInfo[];
}

export interface CreateProcessRequest {
  name: string;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  restart_policy?: Partial<RestartPolicy>;
  auto_start?: boolean;
  group_name?: string;
  log_config?: Partial<ProcessLogConfig>;
  run_as?: string;
  instance_count?: number;
  pty_mode?: boolean;
}

export interface UpdateProcessRequest {
  id: string;
  name?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  restart_policy?: RestartPolicy;
  auto_start?: boolean;
  group_name?: string | null;
  log_config?: ProcessLogConfig;
  run_as?: string | null;
  instance_count?: number;
  pty_mode?: boolean;
}

export interface LogLine {
  stream: string;
  line: string;
  timestamp: string | null;
}

export interface LogsResponse {
  process_id: string;
  instance: number;
  lines: LogLine[];
  has_more: boolean;
  total_lines: number;
}

export interface PtyReplayResponse {
  process_id: string;
  instance: number;
  /** Base64-encoded raw PTY output bytes. */
  data: string;
  total_size: number;
  offset: number;
  length: number;
}

interface GroupActionResponse {
  success: boolean;
  errors?: string[] | null;
}

export function getAggregateStatus(instances: InstanceInfo[]): ProcessStatus {
  if (instances.some((i) => i.status === "running")) return "running";
  if (instances.some((i) => i.status === "starting")) return "starting";
  if (instances.some((i) => i.status === "errored")) return "errored";
  if (instances.some((i) => i.status === "failed")) return "failed";
  if (instances.length > 0 && instances.every((i) => i.status === "stopped")) return "stopped";
  return "created";
}

export function getInstanceByIndex(process: ProcessInfo, index: number): InstanceInfo | undefined {
  return process.instances.find((instance) => instance.index === index);
}

interface ProcessState {
  processes: ProcessInfo[];
  groups: string[];
  isLoading: boolean;
  error: string | null;

  fetchProcesses: () => Promise<void>;
  fetchGroups: () => Promise<void>;
  createProcess: (req: CreateProcessRequest) => Promise<ProcessInfo>;
  updateProcess: (req: UpdateProcessRequest) => Promise<ProcessInfo>;
  startProcess: (id: string) => Promise<void>;
  stopProcess: (id: string) => Promise<void>;
  restartProcess: (id: string) => Promise<void>;
  deleteProcess: (id: string) => Promise<void>;
  startGroup: (groupName: string) => Promise<void>;
  stopGroup: (groupName: string) => Promise<void>;
  fetchLogs: (
    id: string,
    options?: { stream?: string; lines?: number; offset?: number; instance?: number }
  ) => Promise<LogsResponse>;
  fetchPtyReplay: (
    id: string,
    options?: { instance?: number; offset?: number; length?: number }
  ) => Promise<PtyReplayResponse>;
  subscribeToEvents: () => () => void;
}

function ensureGroupActionSuccess(result: GroupActionResponse, groupName: string) {
  if (result.success) return;
  const errors = result.errors ?? [];
  const suffix = errors.length > 0 ? `: ${errors.join("; ")}` : "";
  throw new Error(`Failed to operate group ${groupName}${suffix}`);
}

export const useProcessStore = create<ProcessState>((set) => ({
  processes: [],
  groups: [],
  isLoading: false,
  error: null,

  fetchProcesses: async () => {
    set({ isLoading: true, error: null });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<ProcessInfo[]>("process.list");
      set({ processes: result, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load processes",
      });
    }
  },

  fetchGroups: async () => {
    try {
      const rpc = getRpcClient();
      const groups = await rpc.call<string[]>("process.group.list");
      set({ groups });
    } catch {
      set({ groups: [] });
    }
  },

  createProcess: async (req) => {
    const rpc = getRpcClient();
    const result = await rpc.call<ProcessInfo>("process.create", req as unknown as Record<string, unknown>);
    set((state) => ({ processes: [...state.processes, result] }));
    return result;
  },

  updateProcess: async (req) => {
    const rpc = getRpcClient();
    const result = await rpc.call<ProcessInfo>("process.update", req as unknown as Record<string, unknown>);
    set((state) => ({
      processes: state.processes.map((p) => (p.id === result.id ? result : p)),
    }));
    return result;
  },

  startProcess: async (id) => {
    const rpc = getRpcClient();
    await rpc.call("process.start", { id });
  },

  stopProcess: async (id) => {
    const rpc = getRpcClient();
    await rpc.call("process.stop", { id });
  },

  restartProcess: async (id) => {
    const rpc = getRpcClient();
    await rpc.call("process.restart", { id });
  },

  deleteProcess: async (id) => {
    const rpc = getRpcClient();
    await rpc.call("process.delete", { id });
    set((state) => ({
      processes: state.processes.filter((p) => p.id !== id),
    }));
  },

  startGroup: async (groupName) => {
    const rpc = getRpcClient();
    const result = await rpc.call<GroupActionResponse>("process.group.start", {
      group_name: groupName,
    });
    ensureGroupActionSuccess(result, groupName);
  },

  stopGroup: async (groupName) => {
    const rpc = getRpcClient();
    const result = await rpc.call<GroupActionResponse>("process.group.stop", {
      group_name: groupName,
    });
    ensureGroupActionSuccess(result, groupName);
  },

  fetchLogs: async (id, options = {}) => {
    const rpc = getRpcClient();
    const params = {
      id,
      stream: options.stream ?? "all",
      lines: options.lines ?? 500,
      offset: options.offset ?? 0,
      instance: options.instance,
    };
    return await rpc.call<LogsResponse>("process.logs", params);
  },

  fetchPtyReplay: async (id, options = {}) => {
    const rpc = getRpcClient();
    const params = {
      id,
      instance: options.instance ?? 0,
      offset: options.offset ?? 0,
      length: options.length ?? 256 * 1024,
    };
    return await rpc.call<PtyReplayResponse>("process.pty_replay", params);
  },

  subscribeToEvents: () => {
    const rpc = getRpcClient();

    const unsubStatus = rpc.on(
      "event.process.status_changed",
      (params: unknown) => {
        const data = params as {
          process_id: string;
          instance: number;
          status: ProcessStatus;
          pid?: number | null;
          exit_code?: number | null;
          pty_session_id?: string | null;
        };
        const hasPid = Object.prototype.hasOwnProperty.call(data, "pid");
        const hasExitCode = Object.prototype.hasOwnProperty.call(data, "exit_code");
        const hasPtySessionId = Object.prototype.hasOwnProperty.call(data, "pty_session_id");

        set((state) => ({
          processes: state.processes.map((process) => {
            if (process.id !== data.process_id) {
              return process;
            }

            const nextInstances = process.instances.map((inst) => {
              if (inst.index !== data.instance) {
                return inst;
              }
              return {
                ...inst,
                status: data.status,
                pid: hasPid ? data.pid ?? null : inst.pid,
                exit_code: hasExitCode
                  ? data.exit_code ?? null
                  : data.status === "running" || data.status === "starting"
                    ? null
                    : inst.exit_code,
                pty_session_id: hasPtySessionId
                  ? data.pty_session_id ?? null
                  : data.status === "stopped" || data.status === "errored" || data.status === "failed"
                    ? null
                    : inst.pty_session_id,
                started_at:
                  data.status === "running"
                    ? new Date().toISOString()
                    : data.status === "stopped"
                    ? null
                    : inst.started_at,
              };
            });

            return {
              ...process,
              instances: nextInstances,
            };
          }),
        }));
      }
    );

    const unsubConfig = rpc.on(
      "event.process.config_updated",
      (params: unknown) => {
        const data = params as {
          process_id: string;
        };
        void rpc
          .call<ProcessInfo>("process.get", { id: data.process_id })
          .then((updated) => {
            set((state) => ({
              processes: state.processes.map((p) => (p.id === updated.id ? updated : p)),
            }));
          })
          .catch((err) => {
            console.error("Failed to sync updated process:", err);
          });
      }
    );

    return () => {
      unsubStatus();
      unsubConfig();
    };
  },
}));
