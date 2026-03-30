import { useCallback, useEffect, useState } from "react";
import { Calendar, Loader2, Terminal } from "lucide-react";

import { AppHeader } from "~/components/app-header";
import { CreateProcessDialog } from "~/components/processes/create-process-dialog";
import { EditProcessDialog } from "~/components/processes/edit-process-dialog";
import { LogViewer } from "~/components/processes/log-viewer";
import { ProcessPtyViewer } from "~/components/processes/process-pty-viewer";
import {
  groupProcesses,
  ProcessGroup,
  ProcessRow,
} from "~/components/processes/process-list";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TooltipProvider } from "~/components/ui/tooltip";
import { useProcessStore } from "~/stores/process-store";

export function meta() {
  return [
    { title: "Processes — XDeck" },
    { name: "description", content: "Manage your processes with XDeck" },
  ];
}

export default function ProcessesPage() {
  const {
    processes,
    isLoading,
    fetchProcesses,
    fetchGroups,
    startProcess,
    stopProcess,
    restartProcess,
    deleteProcess,
    updateProcess,
    startGroup,
    stopGroup,
    subscribeToEvents,
  } = useProcessStore();

  const [viewingLogs, setViewingLogs] = useState<string | null>(null);
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [scheduleDialogGroup, setScheduleDialogGroup] = useState<string | null>(null);

  useEffect(() => {
    void fetchProcesses();
    void fetchGroups();
    const unsubscribe = subscribeToEvents();
    return unsubscribe;
  }, [fetchProcesses, fetchGroups, subscribeToEvents]);

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

  const handleStartGroup = useCallback(
    (name: string) => {
      const grouped = groupProcesses(processes);
      const groupProcs = grouped.get(name) ?? [];
      const hasSchedule = groupProcs.some((p) => p.mode === "schedule");

      if (hasSchedule) {
        setScheduleDialogGroup(name);
      } else {
        void startGroup(name, "skip").catch((err) => {
          console.error(`Failed to start group ${name}:`, err);
        });
      }
    },
    [processes, startGroup]
  );

  const handleScheduleDialogChoice = async (trigger: "skip" | "trigger_once") => {
    const groupName = scheduleDialogGroup;
    setScheduleDialogGroup(null);
    if (!groupName) return;
    try {
      await startGroup(groupName, trigger);
    } catch (err) {
      console.error(`Failed to start group ${groupName}:`, err);
    }
  };

  const handleStopGroup = async (name: string) => {
    try {
      await stopGroup(name);
    } catch (err) {
      console.error(`Failed to stop group ${name}:`, err);
    }
  };

  const handleToggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await updateProcess({ id, enabled });
      } catch (err) {
        console.error(`Failed to toggle enabled for process ${id}:`, err);
      }
    },
    [updateProcess]
  );

  const handleToggleGroupEnabled = useCallback(
    async (groupName: string, enabled: boolean) => {
      const grouped = groupProcesses(processes);
      const groupProcs = grouped.get(groupName) ?? [];
      const toUpdate = groupProcs.filter((p) => p.enabled !== enabled);
      await Promise.allSettled(
        toUpdate.map((p) =>
          updateProcess({ id: p.id, enabled }).catch((err) =>
            console.error(`Failed to toggle enabled for process ${p.id}:`, err)
          )
        )
      );
    },
    [processes, updateProcess]
  );

  const logProcess = viewingLogs
    ? processes.find((p) => p.id === viewingLogs)
    : null;
  const editingProcess = editingProcessId
    ? processes.find((p) => p.id === editingProcessId) ?? null
    : null;

  const grouped = groupProcesses(processes);
  const hasGroups = grouped.size > 1 || (grouped.size === 1 && !grouped.has(null));

  if (viewingLogs && logProcess) {
    if (logProcess.pty_mode) {
      return (
        <>
          <AppHeader title="Process Terminal" />
          <div className="flex-1 overflow-hidden">
            <ProcessPtyViewer process={logProcess} onClose={() => setViewingLogs(null)} />
          </div>
        </>
      );
    }

    return (
      <>
        <AppHeader title="Process Logs" />
        <div className="flex-1 overflow-hidden">
          <LogViewer
            processId={viewingLogs}
            processName={logProcess.name}
            instanceCount={logProcess.instance_count}
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

      {/* Schedule trigger dialog */}
      <Dialog
        open={scheduleDialogGroup !== null}
        onOpenChange={(open) => {
          if (!open) setScheduleDialogGroup(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="size-5 text-blue-500" />
              Scheduled Processes Detected
            </DialogTitle>
            <DialogDescription>
              Group <span className="font-medium text-foreground">{scheduleDialogGroup}</span> contains
              scheduled processes. How would you like to handle them?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => void handleScheduleDialogChoice("skip")}
            >
              <span className="mr-2 text-muted-foreground">→</span>
              Start daemons only, skip scheduled tasks
            </Button>
            <Button
              className="w-full justify-start"
              onClick={() => void handleScheduleDialogChoice("trigger_once")}
            >
              <span className="mr-2">⚡</span>
              Start daemons and trigger schedules once
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TooltipProvider>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Process Manager</h2>
                <p className="text-sm text-muted-foreground">
                  Manage your application processes with auto-restart and monitoring.
                </p>
              </div>
              <CreateProcessDialog onCreated={fetchProcesses} />
            </div>

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
                  <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
                    <Terminal className="size-6 text-muted-foreground" />
                  </div>
                  <CardTitle className="mb-2 text-lg">No processes yet</CardTitle>
                  <CardDescription className="mb-6 max-w-sm">
                    Create your first managed process to start monitoring and
                    auto-restarting your applications.
                  </CardDescription>
                  <CreateProcessDialog onCreated={fetchProcesses} />
                </CardContent>
              </Card>
            ) : hasGroups ? (
              <div className="space-y-4">
                {[...grouped.entries()].map(([groupName, groupedProcesses]) => (
                  <ProcessGroup
                    key={groupName ?? "__ungrouped__"}
                    groupName={groupName}
                    processes={groupedProcesses}
                    onAction={handleAction}
                    onViewLogs={setViewingLogs}
                    onStartGroup={handleStartGroup}
                    onStopGroup={handleStopGroup}
                    onToggleEnabled={handleToggleEnabled}
                    onToggleGroupEnabled={handleToggleGroupEnabled}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {processes.map((process) => (
                  <ProcessRow
                    key={process.id}
                    process={process}
                    onAction={handleAction}
                    onViewLogs={setViewingLogs}
                    onToggleEnabled={handleToggleEnabled}
                    showGroupBadge
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </TooltipProvider>
    </>
  );
}
