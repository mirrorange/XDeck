import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Folder, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { getRpcClient } from "~/lib/rpc-client";
import type { DirListing, FileEntry } from "~/stores/file-store";
import { cn } from "~/lib/utils";

interface MoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePaths: string[];
  mode: "copy" | "move";
  onCompleted: () => void;
}

export function MoveDialog({
  open,
  onOpenChange,
  sourcePaths,
  mode,
  onCompleted,
}: MoveDialogProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("/");

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const rpc = getRpcClient();
      const result = (await rpc.call("fs.list", { path })) as DirListing;
      setEntries(result.entries.filter((e) => e.type === "directory"));
      setCurrentPath(result.path);
      setPathInput(result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      // Start from parent of first source
      const firstSource = sourcePaths[0];
      if (firstSource) {
        const parent = firstSource.substring(0, firstSource.lastIndexOf("/")) || "/";
        void loadDirectory(parent);
      }
    }
  }, [open, sourcePaths, loadDirectory]);

  const handleProcess = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const rpc = getRpcClient();
      const method = mode === "copy" ? "fs.copy" : "fs.move";

      for (const sourcePath of sourcePaths) {
        const fileName = sourcePath.split("/").pop();
        const destPath = currentPath.endsWith("/")
          ? `${currentPath}${fileName}`
          : `${currentPath}/${fileName}`;
        await rpc.call(method, { from: sourcePath, to: destPath });
      }

      onOpenChange(false);
      onCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${mode}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const names = sourcePaths.map((p) => p.split("/").pop()).filter(Boolean);
  const label = mode === "copy" ? "Copy" : "Move";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-all leading-tight">
            {label} {names.length === 1 ? `"${names[0]}"` : `${names.length} items`}
          </DialogTitle>
          <DialogDescription>
            Choose a destination folder
          </DialogDescription>
        </DialogHeader>

        {/* Path input */}
        <Input
          className="font-mono text-sm"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadDirectory(pathInput);
          }}
        />

        {/* Directory picker */}
        <ScrollArea className="h-[300px] rounded-md border">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="p-1">
              {/* Go up */}
              {currentPath !== "/" && (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => {
                    const parent =
                      currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
                    void loadDirectory(parent);
                  }}
                >
                  <Folder className="size-4 text-amber-500" />
                  <span>..</span>
                </button>
              )}
              {entries.map((entry) => {
                const isSource = sourcePaths.includes(entry.path);
                return (
                  <button
                    key={entry.path}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                      isSource && "opacity-40 pointer-events-none"
                    )}
                    onClick={() => void loadDirectory(entry.path)}
                    disabled={isSource}
                  >
                    <Folder className="size-4 text-amber-500" />
                    <span className="min-w-0 flex-1 truncate text-left" title={entry.name}>
                      {entry.name}
                    </span>
                    <ChevronRight className="size-3 text-muted-foreground" />
                  </button>
                );
              })}
              {entries.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No subdirectories
                </p>
              )}
            </div>
          )}
        </ScrollArea>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleProcess()}
            disabled={isProcessing || !currentPath}
          >
            {isProcessing && <Loader2 className="mr-2 size-4 animate-spin" />}
            {label} here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
