import { useCallback, useEffect, useState } from "react";
import {
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2,
  Eraser,
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
import { useDockerStore, type ImageInfo } from "~/stores/docker-store";

function shortId(id: string): string {
  return id.replace("sha256:", "").substring(0, 12);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ImageList() {
  const {
    images,
    imagesLoading,
    fetchImages,
    removeImage,
    pruneImages,
  } = useDockerStore();

  const [deleteTarget, setDeleteTarget] = useState<ImageInfo | null>(null);
  const [pruneConfirm, setPruneConfirm] = useState(false);
  const [pruneResult, setPruneResult] = useState<{
    images_deleted: number;
    space_reclaimed: number;
  } | null>(null);

  const refresh = useCallback(() => void fetchImages(), [fetchImages]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const confirmDelete = async () => {
    if (deleteTarget) {
      try {
        await removeImage(deleteTarget.id, true);
      } catch (err) {
        console.error("Failed to remove image:", err);
      }
      setDeleteTarget(null);
    }
  };

  const confirmPrune = async () => {
    try {
      const result = await pruneImages();
      setPruneResult(result);
    } catch (err) {
      console.error("Failed to prune images:", err);
    }
    setPruneConfirm(false);
  };

  const unusedCount = images.filter((i) => !i.in_use).length;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Images</h3>
          <p className="text-sm text-muted-foreground">
            {images.length} image{images.length !== 1 ? "s" : ""}
            {unusedCount > 0 && ` (${unusedCount} unused)`}
          </p>
        </div>
        <div className="flex gap-2">
          {unusedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPruneConfirm(true)}
            >
              <Eraser className="mr-2 size-4" />
              Prune Unused
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={imagesLoading}>
            {imagesLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {imagesLoading && images.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading images…</span>
          </CardContent>
        </Card>
      ) : images.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
              <HardDrive className="size-6 text-muted-foreground" />
            </div>
            <CardTitle className="mb-2 text-lg">No images</CardTitle>
            <CardDescription className="max-w-sm">
              No images found. Pull images using Docker CLI.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository / Tag</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>In Use</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {images.map((img) => (
                <TableRow key={img.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      {img.repo_tags.length > 0 ? (
                        img.repo_tags.map((tag) => (
                          <span key={tag} className="font-mono text-sm">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-sm italic">
                          &lt;none&gt;
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground font-mono">
                      {shortId(img.id)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(img.created)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-mono">{formatSize(img.size)}</span>
                  </TableCell>
                  <TableCell>
                    {img.in_use ? (
                      <Badge variant="secondary" className="bg-green-500/15 text-green-700 dark:text-green-400">
                        In use
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-gray-500/15 text-gray-700 dark:text-gray-400">
                        Unused
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(img)}
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

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Image</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove image{" "}
              <strong>
                {deleteTarget?.repo_tags[0] || shortId(deleteTarget?.id ?? "")}
              </strong>
              ? This action cannot be undone.
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

      {/* Prune confirmation */}
      <AlertDialog open={pruneConfirm} onOpenChange={setPruneConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prune Unused Images</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all unused images that are not referenced by any
              container. This action cannot be undone. Currently {unusedCount} unused image{unusedCount !== 1 ? "s" : ""} found.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmPrune}
            >
              Prune
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Prune result */}
      <AlertDialog open={!!pruneResult} onOpenChange={() => setPruneResult(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prune Complete</AlertDialogTitle>
            <AlertDialogDescription>
              Removed {pruneResult?.images_deleted ?? 0} image
              {(pruneResult?.images_deleted ?? 0) !== 1 ? "s" : ""}, reclaimed{" "}
              {formatSize(pruneResult?.space_reclaimed ?? 0)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
