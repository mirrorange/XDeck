import { create } from "zustand";
import { toast } from "sonner";
import { getRpcClient } from "~/lib/rpc-client";
import { useFileStore } from "~/stores/file-store";

// ── Types ──────────────────────────────────────────────────────────────────

export type TaskType =
  | "compress"
  | "extract"
  | "upload"
  | "download"
  | "folder_download"
  | "copy";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  task_type: TaskType;
  title: string;
  status: TaskStatus;
  progress: number | null;
  message: string | null;
  created_at: number;
  updated_at: number;
}

// ── Store ──────────────────────────────────────────────────────────────────

interface TaskStore {
  /** Map of task id → Task for O(1) lookups */
  tasks: Map<string, Task>;
  /** Whether the task list panel is visible */
  panelOpen: boolean;

  // Actions
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  fetchTasks: () => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  dismissTask: (id: string) => void;
  clearCompleted: () => void;
  subscribeToEvents: () => () => void;

  // Client-side task management (for uploads, etc.)
  addClientTask: (id: string, taskType: TaskType, title: string) => void;
  updateClientTask: (id: string, updates: Partial<Pick<Task, "status" | "progress" | "message">>) => void;
}

/** Max age for auto-dismissing completed/failed/cancelled tasks (60s) */
const AUTO_DISMISS_MS = 60_000;

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: new Map(),
  panelOpen: false,

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  fetchTasks: async () => {
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ tasks: Task[]; total: number }>(
        "task.list",
        {}
      );
      const map = new Map<string, Task>();
      for (const task of result.tasks) {
        map.set(task.id, task);
      }
      set({ tasks: map });
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
    }
  },

  cancelTask: async (id) => {
    try {
      const rpc = getRpcClient();
      await rpc.call<{ cancelled: boolean }>("task.cancel", { id });
    } catch (err) {
      console.error("Failed to cancel task:", err);
    }
  },

  dismissTask: (id) => {
    set((s) => {
      const next = new Map(s.tasks);
      next.delete(id);
      return { tasks: next };
    });
  },

  clearCompleted: () => {
    set((s) => {
      const next = new Map<string, Task>();
      for (const [id, task] of s.tasks) {
        if (
          task.status !== "completed" &&
          task.status !== "failed" &&
          task.status !== "cancelled"
        ) {
          next.set(id, task);
        }
      }
      return { tasks: next };
    });
  },

  addClientTask: (id, taskType, title) => {
    const now = Date.now();
    const task: Task = {
      id,
      task_type: taskType,
      title,
      status: "running",
      progress: 0,
      message: null,
      created_at: now,
      updated_at: now,
    };
    set((s) => {
      const next = new Map(s.tasks);
      next.set(id, task);
      return { tasks: next, panelOpen: true };
    });
  },

  updateClientTask: (id, updates) => {
    set((s) => {
      const existing = s.tasks.get(id);
      if (!existing) return s;
      const updated: Task = {
        ...existing,
        ...updates,
        updated_at: Date.now(),
      };
      const next = new Map(s.tasks);
      next.set(id, updated);
      return { tasks: next };
    });

    // Handle completion/failure side effects
    const task = get().tasks.get(id);
    if (task) {
      if (task.status === "completed") {
        toast.success(`${task.title} completed`);
        scheduleAutoDismiss(id);
        refreshActiveTabIfNeeded(task);
      } else if (task.status === "failed") {
        toast.error(`${task.title} failed`, {
          description: task.message ?? undefined,
        });
        scheduleAutoDismiss(id);
      }
    }
  },

  subscribeToEvents: () => {
    const rpc = getRpcClient();

    const upsertTask = (params: unknown) => {
      const task = params as Task;
      set((s) => {
        const next = new Map(s.tasks);
        next.set(task.id, task);
        return { tasks: next };
      });
    };

    const unsubCreated = rpc.on("event.task.created", (params: unknown) => {
      upsertTask(params);
      // Auto-open panel when a new task starts
      set({ panelOpen: true });
    });

    const unsubProgress = rpc.on("event.task.progress", upsertTask);

    const unsubCompleted = rpc.on("event.task.completed", (params: unknown) => {
      const task = params as Task;
      upsertTask(params);
      toast.success(`${task.title} completed`);
      scheduleAutoDismiss(task.id);
      // Auto-refresh active tab when a filesystem-modifying task completes
      refreshActiveTabIfNeeded(task);
    });

    const unsubFailed = rpc.on("event.task.failed", (params: unknown) => {
      const task = params as Task;
      upsertTask(params);
      toast.error(`${task.title} failed`, {
        description: task.message ?? undefined,
      });
      scheduleAutoDismiss(task.id);
    });

    const unsubCancelled = rpc.on(
      "event.task.cancelled",
      (params: unknown) => {
        const task = params as Task;
        upsertTask(params);
        toast.info(`${task.title} cancelled`);
        scheduleAutoDismiss(task.id);
      }
    );

    return () => {
      unsubCreated();
      unsubProgress();
      unsubCompleted();
      unsubFailed();
      unsubCancelled();
    };
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function scheduleAutoDismiss(taskId: string) {
  setTimeout(() => {
    const task = useTaskStore.getState().tasks.get(taskId);
    if (
      task &&
      (task.status === "completed" ||
        task.status === "failed" ||
        task.status === "cancelled")
    ) {
      useTaskStore.getState().dismissTask(taskId);
    }
  }, AUTO_DISMISS_MS);
}

/** Refresh the active file tab when a filesystem-modifying task finishes */
function refreshActiveTabIfNeeded(task: Task) {
  const fsTaskTypes: TaskType[] = ["compress", "extract", "upload", "folder_download"];
  if (!fsTaskTypes.includes(task.task_type)) return;

  const fileStore = useFileStore.getState();
  const activeTab = fileStore.getActiveTab();
  if (activeTab) {
    void fileStore.refresh(activeTab.id);
  }
}

// ── Selectors ──────────────────────────────────────────────────────────────

/** Get tasks sorted by creation time (newest first) */
export function getTaskList(tasks: Map<string, Task>): Task[] {
  return Array.from(tasks.values()).sort(
    (a, b) => b.created_at - a.created_at
  );
}

/** Count of active (pending/running) tasks */
export function getActiveTaskCount(tasks: Map<string, Task>): number {
  let count = 0;
  for (const task of tasks.values()) {
    if (task.status === "pending" || task.status === "running") {
      count++;
    }
  }
  return count;
}
