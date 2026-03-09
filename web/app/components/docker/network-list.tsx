import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Network,
  RefreshCw,
  Trash2,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { useDockerStore, type DockerNetworkInfo } from "~/stores/docker-store";

function shortId(id: string): string {
  return id.substring(0, 12);
}

const BUILTIN_NETWORKS = ["bridge", "host", "none"];

export function NetworkList() {
  const {
    networks,
    networksLoading,
    fetchNetworks,
    removeNetwork,
  } = useDockerStore();

  const [deleteTarget, setDeleteTarget] = useState<DockerNetworkInfo | null>(null);

  const refresh = useCallback(() => void fetchNetworks(), [fetchNetworks]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const confirmDelete = async () => {
    if (deleteTarget) {
      try {
        await removeNetwork(deleteTarget.id);
      } catch (err) {
        console.error("Failed to remove network:", err);
      }
      setDeleteTarget(null);
    }
  };

  const isBuiltin = (name: string) => BUILTIN_NETWORKS.includes(name);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Networks</h3>
          <p className="text-sm text-muted-foreground">
            {networks.length} network{networks.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={networksLoading}>
          {networksLoading ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Refresh
        </Button>
      </div>

      {networksLoading && networks.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading networks…</span>
          </CardContent>
        </Card>
      ) : networks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
              <Network className="size-6 text-muted-foreground" />
            </div>
            <CardTitle className="mb-2 text-lg">No networks</CardTitle>
            <CardDescription className="max-w-sm">
              No Docker networks found.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Containers</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {networks.map((net) => (
                <TableRow key={net.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{net.name}</span>
                      {isBuiltin(net.name) && (
                        <Badge variant="outline" className="text-xs">
                          built-in
                        </Badge>
                      )}
                      {net.internal && (
                        <Badge variant="secondary" className="text-xs">
                          internal
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground font-mono">
                      {shortId(net.id)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{net.driver}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{net.scope}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-mono">{net.containers}</span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      disabled={isBuiltin(net.name)}
                      onClick={() => setDeleteTarget(net)}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Remove</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Network</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove network{" "}
              <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
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
    </>
  );
}
