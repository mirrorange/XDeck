import { create } from "zustand";
import { getRpcClient } from "~/lib/rpc-client";

// ── Types mirroring the Rust ProcessInfo struct ──────────────────

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
  created_at: string;
  updated_at: string;
  status: ProcessStatus;
  pid: number | null;
  restart_count: number;
  started_at: string | null;
  exit_code: number | null;
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
}

export interface LogLine {
  stream: string;
  line: string;
  timestamp: string | null;
}

export interface LogsResponse {
  process_id: string;
  lines: LogLine[];
  has_more: boolean;
}

interface ProcessState {
  processes: ProcessInfo[];
  isLoading: boolean;
  error: string | null;

  fetchProcesses: () => Promise<void>;
  createProcess: (req: CreateProcessRequest) => Promise<ProcessInfo>;
  updateProcess: (req: UpdateProcessRequest) => Promise<ProcessInfo>;
  startProcess: (id: string) => Promise<void>;
  stopProcess: (id: string) => Promise<void>;
  restartProcess: (id: string) => Promise<void>;
  deleteProcess: (id: string) => Promise<void>;
  fetchLogs: (id: string, options?: { stream?: string; lines?: number; offset?: number }) => Promise<LogsResponse>;
  subscribeToEvents: () => () => void;
}

export const useProcessStore = create<ProcessState>((set, get) => ({
  processes: [],
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

  fetchLogs: async (id, options = {}) => {
    const rpc = getRpcClient();
    const params = {
      id,
      stream: options.stream ?? "all",
      lines: options.lines ?? 500,
      offset: options.offset ?? 0,
    };
    return await rpc.call<LogsResponse>("process.logs", params);
  },

  subscribeToEvents: () => {
    const rpc = getRpcClient();

    const unsubStatus = rpc.on(
      "event.process.status_changed",
      (params: unknown) => {
        const data = params as {
          process_id: string;
          status: ProcessStatus;
          pid?: number;
          exit_code?: number;
        };
        set((state) => ({
          processes: state.processes.map((p) =>
            p.id === data.process_id
              ? {
                  ...p,
                  status: data.status,
                  pid: data.pid ?? p.pid,
                  exit_code: data.exit_code ?? p.exit_code,
                }
              : p
          ),
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
