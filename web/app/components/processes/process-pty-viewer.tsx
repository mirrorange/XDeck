import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Code2, History, Layers, TerminalSquare } from "lucide-react";

import { PtyReplayViewer } from "~/components/processes/pty-replay-viewer";
import { ProcessPtyPlaceholder, ProcessPtyView } from "~/components/terminal/ProcessPtyView";
import { SnippetSidebar } from "~/components/snippets/SnippetSidebar";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { getInstanceByIndex, type ProcessInfo } from "~/stores/process-store";
import { useSnippetSidebar } from "~/hooks/use-snippet-sidebar";

function getDefaultInstanceIndex(process: ProcessInfo) {
  return process.instances.find((instance) => instance.pty_session_id)?.index ?? 0;
}

type ViewMode = "live" | "replay";

export function ProcessPtyViewer({
  process,
  onClose,
}: {
  process: ProcessInfo;
  onClose: () => void;
}) {
  const [selectedInstance, setSelectedInstance] = useState(() => getDefaultInstanceIndex(process));
  const [isConnected, setIsConnected] = useState(false);
  const [hasManualSelection, setHasManualSelection] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const {
    snippetOpen,
    toggleSnippet,
    setActiveSessionId,
    registerSendInput,
    unregisterSendInput,
    executeSnippet,
  } = useSnippetSidebar();

  useEffect(() => {
    setSelectedInstance(getDefaultInstanceIndex(process));
    setHasManualSelection(false);
  }, [process.id]);

  useEffect(() => {
    setSelectedInstance((current) => {
      if (current >= process.instance_count) {
        return getDefaultInstanceIndex(process);
      }

      if (hasManualSelection) {
        return current;
      }

      const currentInstance = getInstanceByIndex(process, current);
      if (currentInstance?.pty_session_id) {
        return current;
      }

      return getDefaultInstanceIndex(process);
    });
  }, [hasManualSelection, process]);

  const selectedProcessInstance = useMemo(
    () => getInstanceByIndex(process, selectedInstance),
    [process, selectedInstance]
  );
  const selectedSessionId = selectedProcessInstance?.pty_session_id ?? null;

  useEffect(() => {
    setIsConnected(false);
  }, [selectedSessionId]);

  useEffect(() => {
    setActiveSessionId(selectedSessionId);
  }, [selectedSessionId, setActiveSessionId]);

  const handleSendInputReady = useCallback(
    (sendInput: ((data: string | Uint8Array) => void) | null) => {
      if (!selectedSessionId) return;
      if (sendInput) {
        registerSendInput(selectedSessionId, sendInput);
      } else {
        unregisterSendInput(selectedSessionId);
      }
    },
    [selectedSessionId, registerSendInput, unregisterSendInput]
  );

  // Show replay viewer when in replay mode
  if (viewMode === "replay") {
    return (
      <PtyReplayViewer
        key={`replay-${process.id}-${selectedInstance}`}
        process={process}
        onClose={() => setViewMode("live")}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-8" onClick={onClose}>
            <ChevronLeft className="size-4" />
          </Button>
          <div>
            <h3 className="font-medium">{process.name}</h3>
            <p className="text-xs text-muted-foreground">Process Terminal</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-7 items-center gap-2 rounded-md border px-2 text-xs text-muted-foreground">
            <TerminalSquare className="size-3.5" />
            <span>{selectedSessionId ? "PTY Session" : "No Session"}</span>
            <span
              className={`inline-flex size-2 rounded-full ${
                selectedSessionId
                  ? isConnected
                    ? "bg-green-500"
                    : "bg-yellow-500"
                  : "bg-muted-foreground/30"
              }`}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setViewMode("replay")}
          >
            <History className="size-3" />
            Replay
          </Button>

          {process.instance_count > 1 && (
            <Select
              value={String(selectedInstance)}
              onValueChange={(value) => {
                setHasManualSelection(true);
                setSelectedInstance(Number(value));
              }}
            >
              <SelectTrigger size="sm" className="w-auto">
                <Layers className="mr-1.5 size-3" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: process.instance_count }, (_, index) => (
                  <SelectItem key={index} value={String(index)}>
                    Instance {index}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={snippetOpen ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={toggleSnippet}
                >
                  <Code2 className="size-3" />
                  Snippets
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Toggle snippet sidebar</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {selectedSessionId ? (
            <ProcessPtyView
              key={selectedSessionId}
              sessionId={selectedSessionId}
              onConnectionChange={setIsConnected}
              onSendInputReady={handleSendInputReady}
            />
          ) : (
            <ProcessPtyPlaceholder
              title={`Instance ${selectedInstance} terminal is not available`}
              description="Start or restart this instance to create a PTY session, then reconnect here."
            />
          )}
        </div>

        {snippetOpen && <SnippetSidebar onExecute={executeSnippet} />}
      </div>
    </div>
  );
}
