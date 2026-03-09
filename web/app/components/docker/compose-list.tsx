import { useCallback, useEffect, useState } from "react";
import {
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Trash2,
  Download,
  Plus,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useDockerStore, type ComposeProjectInfo } from "~/stores/docker-store";

function statusColor(status: string): string {
  switch (status) {
    case "running":
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "stopped":
    case "exited":
      return "bg-red-500/15 text-red-700 dark:text-red-400";
    case "partial":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    default:
      return "bg-gray-500/15 text-gray-700 dark:text-gray-400";
  }
}

export function ComposeList() {
  const {
    composeProjects,
    composeLoading,
    fetchComposeProjects,
    addComposeProject,
    removeComposeProject,
    composeUp,
    composeDown,
    composeRestart,
    composePull,
  } = useDockerStore();

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [cwd, setCwd] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ComposeProjectInfo | null>(null);
  const [outputDialog, setOutputDialog] = useState<{ title: string; output: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const refresh = useCallback(
    () => void fetchComposeProjects(),
    [fetchComposeProjects]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = async () => {
    if (!name.trim() || !filePath.trim() || !cwd.trim()) return;
    setAddLoading(true);
    try {
      await addComposeProject(name.trim(), filePath.trim(), cwd.trim());
      setAddOpen(false);
      setName("");
      setFilePath("");
      setCwd("");
    } catch (err) {
      console.error("Failed to add compose project:", err);
    }
    setAddLoading(false);
  };

  const confirmDelete = async () => {
    if (deleteTarget) {
      try {
        await removeComposeProject(deleteTarget.id);
      } catch (err) {
        console.error("Failed to remove compose project:", err);
      }
      setDeleteTarget(null);
    }
  };

  const runAction = async (
    project: ComposeProjectInfo,
    action: "up" | "down" | "restart" | "pull"
  ) => {
    setActionLoading(project.id);
    try {
      let output: string;
      switch (action) {
        case "up":
          output = await composeUp(project.id);
          break;
        case "down":
          output = await composeDown(project.id);
          break;
        case "restart":
          output = await composeRestart(project.id);
          break;
        case "pull":
          output = await composePull(project.id);
          break;
      }
      if (output.trim()) {
        setOutputDialog({
          title: `${action.charAt(0).toUpperCase() + action.slice(1)} — ${project.name}`,
          output,
        });
      }
    } catch (err) {
      console.error(`Failed to ${action} compose project:`, err);
    }
    setActionLoading(null);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Compose Projects</h3>
          <p className="text-sm text-muted-foreground">
            {composeProjects.length} project
            {composeProjects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 size-4" />
            Add Project
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={composeLoading}>
            {composeLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {composeLoading && composeProjects.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading projects…</span>
          </CardContent>
        </Card>
      ) : composeProjects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
              <FolderOpen className="size-6 text-muted-foreground" />
            </div>
            <CardTitle className="mb-2 text-lg">No Compose projects</CardTitle>
            <CardDescription className="max-w-sm">
              Add a Docker Compose project to manage its services.
            </CardDescription>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="mr-2 size-4" />
              Add Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Services</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {composeProjects.map((proj) => (
                <TableRow key={proj.id}>
                  <TableCell>
                    <span className="font-medium">{proj.name}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm text-muted-foreground truncate max-w-[250px] block">
                      {proj.file_path}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={statusColor(proj.status)}>
                      {proj.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {proj.services.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {proj.services.map((svc) => (
                          <Badge
                            key={svc.name}
                            variant="outline"
                            className="text-xs"
                          >
                            {svc.name}
                            {svc.state && (
                              <span className="ml-1 text-muted-foreground">
                                ({svc.state})
                              </span>
                            )}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={actionLoading === proj.id}
                        >
                          {actionLoading === proj.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <>
                              <span className="sr-only">Actions</span>
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                              >
                                <circle cx="8" cy="3" r="1.5" />
                                <circle cx="8" cy="8" r="1.5" />
                                <circle cx="8" cy="13" r="1.5" />
                              </svg>
                            </>
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => runAction(proj, "up")}>
                          <Play className="mr-2 size-4" /> Up
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runAction(proj, "down")}>
                          <Square className="mr-2 size-4" /> Down
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runAction(proj, "restart")}>
                          <RotateCw className="mr-2 size-4" /> Restart
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runAction(proj, "pull")}>
                          <Download className="mr-2 size-4" /> Pull
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteTarget(proj)}
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

      {/* Add Project Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Compose Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="compose-name">Project Name</Label>
              <Input
                id="compose-name"
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compose-file">Compose File Path</Label>
              <Input
                id="compose-file"
                placeholder="/path/to/docker-compose.yml"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compose-cwd">Working Directory</Label>
              <Input
                id="compose-cwd"
                placeholder="/path/to/project"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={addLoading || !name.trim() || !filePath.trim() || !cwd.trim()}
            >
              {addLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove Compose project{" "}
              <strong>{deleteTarget?.name}</strong>? This only removes the
              project from XDeck — containers and volumes are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Command output dialog */}
      <Dialog open={!!outputDialog} onOpenChange={() => setOutputDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{outputDialog?.title}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh]">
            <pre className="whitespace-pre-wrap text-xs font-mono bg-muted p-4 rounded-md">
              {outputDialog?.output}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
