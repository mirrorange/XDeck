import { useEffect, useState } from "react";
import { Loader2, Terminal } from "lucide-react";

import { AppHeader } from "~/components/app-header";
import { CreateProcessDialog } from "~/components/processes/create-process-dialog";
import { EditProcessDialog } from "~/components/processes/edit-process-dialog";
import { LogViewer } from "~/components/processes/log-viewer";
import {
  groupProcesses,
  ProcessGroup,
  ProcessRow,
} from "~/components/processes/process-list";
import { ProcessPtyView, ProcessPtyPlaceholder } from "~/components/terminal/ProcessPtyView";
import { Card, CardContent, CardDescription, CardTitle } from "~/components/ui/card";
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
    startGroup,
    stopGroup,
    subscribeToEvents,
  } = useProcessStore();

  const [viewingLogs, setViewingLogs] = useState<string | null>(null);
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);

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

  const handleStartGroup = async (name: string) => {
    try {
      await startGroup(name);
    } catch (err) {
      console.error(`Failed to start group ${name}:`, err);
    }
  };

  const handleStopGroup = async (name: string) => {
    try {
      await stopGroup(name);
    } catch (err) {
      console.error(`Failed to stop group ${name}:`, err);
    }
  };

  const logProcess = viewingLogs
    ? processes.find((p) => p.id === viewingLogs)
    : null;
  const editingProcess = editingProcessId
    ? processes.find((p) => p.id === editingProcessId) ?? null
    : null;

  const grouped = groupProcesses(processes);
  const hasGroups = grouped.size > 1 || (grouped.size === 1 && !grouped.has(null));

  if (viewingLogs && logProcess) {
    // PTY mode: show terminal view if there's an active PTY session
    const ptySessionId = logProcess.pty_mode
      ? logProcess.instances.find((i) => i.pty_session_id)?.pty_session_id ?? null
      : null;

    if (logProcess.pty_mode && ptySessionId) {
      return (
        <>
          <AppHeader title="Process Terminal" />
          <div className="flex-1 overflow-hidden">
            <ProcessPtyView
              key={ptySessionId}
              sessionId={ptySessionId}
              processName={logProcess.name}
              onClose={() => setViewingLogs(null)}
            />
          </div>
        </>
      );
    }

    if (logProcess.pty_mode && !ptySessionId) {
      return (
        <>
          <AppHeader title="Process Terminal" />
          <div className="flex-1 overflow-hidden">
            <div className="flex h-full flex-col">
              <div className="flex h-10 items-center justify-between border-b bg-background/80 px-3">
                <span className="text-sm font-medium">{logProcess.name}</span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setViewingLogs(null)}
                >
                  Back
                </button>
              </div>
              <ProcessPtyPlaceholder />
            </div>
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
                  showGroupBadge
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
