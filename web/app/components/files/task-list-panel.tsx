import { useEffect } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Ban,
  X,
  Loader2,
  ListTodo,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "~/components/ui/button";
import { Drawer, DrawerContent } from "~/components/ui/drawer";
import { Progress } from "~/components/ui/progress";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useMediaQuery } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";
import {
  useTaskStore,
  getTaskList,
  getActiveTaskCount,
  type Task,
  type TaskStatus,
} from "~/stores/task-store";

// ── Task status icon ───────────────────────────────────────────────────────

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case "pending":
      return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
    case "running":
      return <Loader2 className="size-4 animate-spin text-blue-400" />;
    case "completed":
      return <CheckCircle2 className="size-4 text-green-400" />;
    case "failed":
      return <XCircle className="size-4 text-destructive" />;
    case "cancelled":
      return <Ban className="size-4 text-muted-foreground" />;
  }
}

// ── Single task row ────────────────────────────────────────────────────────

function TaskRow({ task }: { task: Task }) {
  const { cancelTask, dismissTask } = useTaskStore();
  const isActive = task.status === "pending" || task.status === "running";
  const isDone =
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "cancelled";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full min-w-0 overflow-hidden"
    >
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-border/50 last:border-b-0">
        <div className="flex items-center gap-2 min-w-0">
          <TaskStatusIcon status={task.status} />
          <span className="min-w-0 flex-1 truncate text-sm" title={task.title}>
            {task.title}
          </span>
          {isActive && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 sm:size-6"
              onClick={() => void cancelTask(task.id)}
              title="Cancel task"
            >
              <X className="size-4 sm:size-3.5" />
            </Button>
          )}
          {isDone && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 sm:size-6"
              onClick={() => void dismissTask(task.id)}
              title="Dismiss"
            >
              <X className="size-4 sm:size-3.5" />
            </Button>
          )}
        </div>

        {isActive && task.progress != null && (
          <div className="flex items-center gap-2">
            <Progress value={task.progress} className="h-1.5 flex-1" />
            <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
              {task.progress}%
            </span>
          </div>
        )}

        {task.message && (
          <p className="block truncate text-xs text-muted-foreground" title={task.message}>
            {task.message}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ── Toggle button (exported for toolbar use) ───────────────────────────────

export function TaskListToggle() {
  const { tasks, togglePanel, panelOpen } = useTaskStore();
  const activeCount = getActiveTaskCount(tasks);

  return (
    <Button
      variant={panelOpen ? "secondary" : "ghost"}
      size="icon"
      className="relative size-8"
      onClick={togglePanel}
      title="Task list"
    >
      <ListTodo className="size-4" />
      <AnimatePresence>
        {activeCount > 0 && (
          <motion.span
            key={activeCount}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
            className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-blue-500 text-[10px] font-medium text-white flex items-center justify-center"
          >
            {activeCount > 9 ? "9+" : activeCount}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────

function TaskListPanelBody({
  taskList,
  activeCount,
  hasFinished,
  onClose,
  className,
}: {
  taskList: Task[];
  activeCount: number;
  hasFinished: boolean;
  onClose: () => void;
  className?: string;
}) {
  const { clearCompleted } = useTaskStore();

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4" />
          <span className="text-sm font-medium">Tasks</span>
          {activeCount > 0 && (
            <span className="text-xs text-muted-foreground">
              ({activeCount} active)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasFinished && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => void clearCompleted()}
              title="Clear finished tasks"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            title="Close panel"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {taskList.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <ListTodo className="mb-2 size-8 opacity-50" />
            <p className="text-sm">No tasks</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {taskList.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </AnimatePresence>
        )}
      </ScrollArea>
    </div>
  );
}

export function TaskListPanel() {
  const { tasks, panelOpen, setPanelOpen, fetchTasks, subscribeToEvents } =
    useTaskStore();
  const isCompactLayout = useMediaQuery("(max-width: 1023px)");

  // Subscribe to task events and fetch initial task list
  useEffect(() => {
    void fetchTasks();
    const unsubscribe = subscribeToEvents();
    return unsubscribe;
  }, [fetchTasks, subscribeToEvents]);

  const taskList = getTaskList(tasks);
  const activeCount = getActiveTaskCount(tasks);
  const hasFinished = taskList.some(
    (t) =>
      t.status === "completed" ||
      t.status === "failed" ||
      t.status === "cancelled"
  );

  if (isCompactLayout) {
    return (
      <Drawer open={panelOpen} onOpenChange={setPanelOpen}>
        <DrawerContent className="h-[75dvh] max-h-[75dvh]">
          <TaskListPanelBody
            taskList={taskList}
            activeCount={activeCount}
            hasFinished={hasFinished}
            onClose={() => setPanelOpen(false)}
          />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <AnimatePresence>
      {panelOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="shrink-0 border-l border-border flex flex-col bg-background overflow-hidden"
        >
          <TaskListPanelBody
            taskList={taskList}
            activeCount={activeCount}
            hasFinished={hasFinished}
            onClose={() => setPanelOpen(false)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
