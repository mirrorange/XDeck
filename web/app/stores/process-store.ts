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
}

interface ProcessState {
  processes: ProcessInfo[];
  isLoading: boolean;
  error: string | null;

  fetchProcesses: () => Promise<void>;
  createProcess: (req: CreateProcessRequest) => Promise<ProcessInfo>;
  startProcess: (id: string) => Promise<void>;
  stopProcess: (id: string) => Promise<void>;
  restartProcess: (id: string) => Promise<void>;
  deleteProcess: (id: string) => Promise<void>;
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

  subscribeToEvents: () => {
    const rpc = getRpcClient();

    const unsub = rpc.on(
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

    return unsub;
  },
}));
