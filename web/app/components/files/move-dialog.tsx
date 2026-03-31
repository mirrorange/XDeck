import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, ChevronRight, Folder, Home, Loader2, RefreshCw } from "lucide-react";

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
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState("/");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const loadDirectory = useCallback(async (path: string, pushHistory = true) => {
    setIsLoading(true);
    setError(null);
    try {
      const rpc = getRpcClient();
      const result = (await rpc.call("fs.list", { path })) as DirListing;
      setEntries(result.entries.filter((e) => e.type === "directory"));
      setCurrentPath(result.path);
      setPathInput(result.path);
      setEditingPath(false);

      if (pushHistory) {
        setHistory((prev) => {
          const trimmed = prev.slice(0, historyIndex + 1);
          return [...trimmed, result.path];
        });
        setHistoryIndex((prev) => prev + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setIsLoading(false);
    }
  }, [historyIndex]);

  useEffect(() => {
    if (open) {
      setHistory([]);
      setHistoryIndex(-1);
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

  const handlePathSubmit = () => {
    setEditingPath(false);
    const trimmed = pathInput.trim();
    if (trimmed && trimmed !== currentPath) {
      void loadDirectory(trimmed);
    } else {
      setPathInput(currentPath);
    }
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      void loadDirectory(history[newIndex], false);
    }
  };

  const goUp = () => {
    if (currentPath !== "/") {
      const parent = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
      void loadDirectory(parent);
    }
  };

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

        {/* Navigation bar */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            disabled={historyIndex <= 0}
            onClick={goBack}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            disabled={currentPath === "/"}
            onClick={goUp}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => {
              const rpc = getRpcClient();
              rpc
                .call("fs.home", {})
                .then((result) => {
                  const home = (result as { home: string }).home;
                  void loadDirectory(home);
                })
                .catch(() => {});
            }}
          >
            <Home className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => void loadDirectory(currentPath, false)}
          >
            <RefreshCw className="size-3.5" />
          </Button>

          {/* Address bar */}
          {editingPath ? (
            <Input
              className="ml-1 h-7 flex-1 font-mono text-sm"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onBlur={handlePathSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePathSubmit();
                if (e.key === "Escape") {
                  setEditingPath(false);
                  setPathInput(currentPath);
                }
              }}
              autoFocus
            />
          ) : (
            <MoveDialogBreadcrumb
              path={currentPath}
              onClick={() => {
                setEditingPath(true);
                setPathInput(currentPath);
              }}
              onNavigate={(p) => void loadDirectory(p)}
            />
          )}
        </div>

        {/* Directory picker */}
        <ScrollArea className="h-[300px] rounded-md border">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="p-1">
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

// ── Breadcrumb for move dialog ──────────────────────────────────

function MoveDialogBreadcrumb({
  path,
  onClick,
  onNavigate,
}: {
  path: string;
  onClick: () => void;
  onNavigate: (path: string) => void;
}) {
  const parts = path.split("/").filter(Boolean);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [path]);

  return (
    <div
      ref={scrollRef}
      className="ml-1 flex h-7 flex-1 cursor-text items-center gap-0.5 overflow-x-auto rounded-md bg-muted/50 px-2 text-sm"
      onClick={onClick}
    >
      <button
        className="shrink-0 px-1 text-muted-foreground transition-colors hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate("/");
        }}
      >
        /
      </button>
      {parts.map((part, i) => {
        const partPath = "/" + parts.slice(0, i + 1).join("/");
        const isLast = i === parts.length - 1;
        return (
          <span key={partPath} className="flex shrink-0 items-center gap-0.5">
            <span className="text-muted-foreground/40">/</span>
            <button
              className={cn(
                "px-0.5 transition-colors hover:text-foreground",
                isLast ? "font-medium text-foreground" : "text-muted-foreground"
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!isLast) onNavigate(partPath);
              }}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}
