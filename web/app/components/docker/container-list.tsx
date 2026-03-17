import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Container,
  Download,
  HardDrive,
  Loader2,
  Network,
  Play,
  RefreshCw,
  Square,
  Trash2,
  RotateCw,
  Pause,
  Eye,
  FileText,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { useDockerStore, type ContainerInfo } from "~/stores/docker-store";
import { ContainerLogsDialog } from "./container-logs-dialog";
import { ContainerDetailDialog } from "./container-detail-dialog";

function stateColor(state: string): string {
  switch (state) {
    case "running":
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "exited":
    case "dead":
      return "bg-red-500/15 text-red-700 dark:text-red-400";
    case "paused":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    case "restarting":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    case "created":
      return "bg-gray-500/15 text-gray-700 dark:text-gray-400";
    default:
      return "bg-gray-500/15 text-gray-700 dark:text-gray-400";
  }
}

function shortId(id: string): string {
  return id.substring(0, 12);
}

function formatPorts(ports: ContainerInfo["ports"]): string {
  return ports
    .filter((p) => p.host_port)
    .map(
      (p) =>
        `${p.host_ip || "0.0.0.0"}:${p.host_port}→${p.container_port}/${p.protocol}`
    )
    .join(", ");
}

export function ContainerList() {
  const {
    containers,
    containersLoading,
    fetchContainers,
    startContainer,
    stopContainer,
    restartContainer,
    removeContainer,
    pauseContainer,
    unpauseContainer,
  } = useDockerStore();

  const [deleteTarget, setDeleteTarget] = useState<ContainerInfo | null>(null);
  const [logsTarget, setLogsTarget] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<string | null>(null);

  const refresh = useCallback(() => void fetchContainers(true), [fetchContainers]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAction = async (action: string, container: ContainerInfo) => {
    try {
      switch (action) {
        case "start":
          await startContainer(container.id);
          break;
        case "stop":
          await stopContainer(container.id);
          break;
        case "restart":
          await restartContainer(container.id);
          break;
        case "pause":
          await pauseContainer(container.id);
          break;
        case "unpause":
          await unpauseContainer(container.id);
          break;
        case "delete":
          setDeleteTarget(container);
          break;
        case "logs":
          setLogsTarget(container.id);
          break;
        case "inspect":
          setDetailTarget(container.id);
          break;
      }
    } catch (err) {
      console.error(`Failed to ${action} container:`, err);
    }
  };

  const confirmDelete = async () => {
    if (deleteTarget) {
      try {
        await removeContainer(deleteTarget.id, true);
      } catch (err) {
        console.error("Failed to remove container:", err);
      }
      setDeleteTarget(null);
    }
  };

  const portsStr = (c: ContainerInfo) => formatPorts(c.ports);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Containers</h3>
          <p className="text-sm text-muted-foreground">
            {containers.length} container{containers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={containersLoading}>
          {containersLoading ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Refresh
        </Button>
      </div>

      {containersLoading && containers.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading containers…</span>
          </CardContent>
        </Card>
      ) : containers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
              <Container className="size-6 text-muted-foreground" />
            </div>
            <CardTitle className="mb-2 text-lg">No containers</CardTitle>
            <CardDescription className="max-w-sm">
              No containers found. Start a container using Docker CLI or Docker Compose.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ports</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {containers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {shortId(c.id)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-mono truncate max-w-[200px] block">
                      {c.image}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={stateColor(c.state)}>
                      {c.state}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{c.status}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-mono text-muted-foreground truncate max-w-[200px] block">
                      {portsStr(c) || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <span className="sr-only">Actions</span>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <circle cx="8" cy="3" r="1.5" />
                            <circle cx="8" cy="8" r="1.5" />
                            <circle cx="8" cy="13" r="1.5" />
                          </svg>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleAction("inspect", c)}>
                          <Eye className="mr-2 size-4" /> Inspect
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleAction("logs", c)}>
                          <FileText className="mr-2 size-4" /> Logs
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {c.state !== "running" && (
                          <DropdownMenuItem onClick={() => handleAction("start", c)}>
                            <Play className="mr-2 size-4" /> Start
                          </DropdownMenuItem>
                        )}
                        {c.state === "running" && (
                          <>
                            <DropdownMenuItem onClick={() => handleAction("stop", c)}>
                              <Square className="mr-2 size-4" /> Stop
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAction("restart", c)}>
                              <RotateCw className="mr-2 size-4" /> Restart
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAction("pause", c)}>
                              <Pause className="mr-2 size-4" /> Pause
                            </DropdownMenuItem>
                          </>
                        )}
                        {c.state === "paused" && (
                          <DropdownMenuItem onClick={() => handleAction("unpause", c)}>
                            <Play className="mr-2 size-4" /> Unpause
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleAction("delete", c)}
                        >
                          <Trash2 className="mr-2 size-4" /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Container</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove container{" "}
              <strong>{deleteTarget?.name}</strong>? This will force-remove the
              container and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Logs dialog */}
      <ContainerLogsDialog
        containerId={logsTarget}
        onClose={() => setLogsTarget(null)}
      />

      {/* Detail dialog */}
      <ContainerDetailDialog
        containerId={detailTarget}
        onClose={() => setDetailTarget(null)}
      />
    </>
  );
}
