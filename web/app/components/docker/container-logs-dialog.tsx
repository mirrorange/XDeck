import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useDockerStore } from "~/stores/docker-store";

interface ContainerLogsDialogProps {
  containerId: string | null;
  onClose: () => void;
}

export function ContainerLogsDialog({
  containerId,
  onClose,
}: ContainerLogsDialogProps) {
  const { containerLogs } = useDockerStore();
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!containerId) {
      setLogs([]);
      return;
    }
    setLoading(true);
    containerLogs(containerId, "500")
      .then(setLogs)
      .catch((err) => {
        console.error("Failed to fetch logs:", err);
        setLogs(["Failed to fetch logs"]);
      })
      .finally(() => setLoading(false));
  }, [containerId, containerLogs]);

  return (
    <Dialog open={!!containerId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Container Logs</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading logs…</span>
          </div>
        ) : (
          <ScrollArea className="h-[60vh] rounded-md border bg-muted/30 p-4">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
              {logs.length > 0 ? logs.join("") : "No logs available."}
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
