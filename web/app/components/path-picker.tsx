import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Home,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "~/components/ui/input-group";
import { ScrollArea } from "~/components/ui/scroll-area";
import { getRpcClient } from "~/lib/rpc-client";
import { cn } from "~/lib/utils";
import type { DirListing, FileEntry } from "~/stores/file-store";

// ── Types ────────────────────────────────────────────────────────

export type PathPickerMode = "file" | "directory" | "any";

interface PathPickerProps {
  /** Current path value */
  value: string;
  /** Callback when path changes */
  onChange: (path: string) => void;
  /** What can be selected: file, directory, or any */
  mode?: PathPickerMode;
  /** Input placeholder text */
  placeholder?: string;
  /** Additional classes for the outer wrapper */
  className?: string;
  /** HTML id for the input element */
  id?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
}

// ── PathPicker (Input + Browse button) ──────────────────────────

export function PathPicker({
  value,
  onChange,
  mode = "any",
  placeholder,
  className,
  id,
  disabled,
}: PathPickerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <InputGroup className={className}>
        <InputGroupInput
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-sm"
          disabled={disabled}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            onClick={() => setDialogOpen(true)}
            disabled={disabled}
            aria-label="Browse files"
          >
            <FolderOpen className="size-3.5" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      <PathPickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={mode}
        initialPath={value}
        onSelect={(path) => {
          onChange(path);
          setDialogOpen(false);
        }}
      />
    </>
  );
}

// ── PathPickerDialog ────────────────────────────────────────────

interface PathPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PathPickerMode;
  initialPath?: string;
  onSelect: (path: string) => void;
}

function PathPickerDialog({
  open,
  onOpenChange,
  mode,
  initialPath,
  onSelect,
}: PathPickerDialogProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Address bar state
  const [editingPath, setEditingPath] = useState(false);
  const [inputPath, setInputPath] = useState("/");

  const loadDirectory = useCallback(
    async (path: string, pushHistory = true) => {
      setIsLoading(true);
      setError(null);
      setSelectedEntry(null);
      try {
        const rpc = getRpcClient();
        const result = (await rpc.call("fs.list", { path })) as DirListing;

        let filtered = result.entries;
        if (mode === "directory") {
          filtered = filtered.filter((e) => e.type === "directory");
        }
        // Sort: directories first, then alphabetically
        filtered.sort((a, b) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name);
        });

        setEntries(filtered);
        setCurrentPath(result.path);
        setInputPath(result.path);
        setEditingPath(false);

        if (pushHistory) {
          setHistory((prev) => {
            const trimmed = prev.slice(0, historyIndex + 1);
            return [...trimmed, result.path];
          });
          setHistoryIndex((prev) => prev + 1);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load directory");
      } finally {
        setIsLoading(false);
      }
    },
    [mode, historyIndex]
  );

  // Reset state on open
  useEffect(() => {
    if (open) {
      setHistory([]);
      setHistoryIndex(-1);
      setSelectedEntry(null);
      setError(null);

      // Determine initial directory
      const startPath = initialPath?.trim() || "";
      if (startPath) {
        // If it looks like a file path (has an extension or doesn't end with /),
        // try to navigate to its parent directory
        const isLikelyFile = startPath.includes(".") && !startPath.endsWith("/");
        const dirPath =
          mode === "directory" || !isLikelyFile
            ? startPath
            : startPath.substring(0, startPath.lastIndexOf("/")) || "/";
        void loadDirectory(dirPath);
      } else {
        // Default to home directory
        const rpc = getRpcClient();
        rpc
          .call("fs.home", {})
          .then((result) => {
            const home = (result as { home: string }).home;
            void loadDirectory(home);
          })
          .catch(() => {
            void loadDirectory("/");
          });
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      void loadDirectory(history[newIndex], false);
    }
  }, [historyIndex, history, loadDirectory]);

  const goUp = useCallback(() => {
    if (currentPath !== "/") {
      const parent = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
      void loadDirectory(parent);
    }
  }, [currentPath, loadDirectory]);

  const handlePathSubmit = () => {
    setEditingPath(false);
    const trimmed = inputPath.trim();
    if (trimmed && trimmed !== currentPath) {
      void loadDirectory(trimmed);
    } else {
      setInputPath(currentPath);
    }
  };

  const handleEntryClick = (entry: FileEntry) => {
    if (entry.type === "directory") {
      void loadDirectory(entry.path);
    } else {
      // File - select it
      setSelectedEntry(entry.path);
    }
  };

  const handleEntryDoubleClick = (entry: FileEntry) => {
    if (entry.type === "directory") {
      if (mode === "directory") {
        onSelect(entry.path);
      }
      // else navigate handled by single click
    } else {
      // Select file on double-click
      onSelect(entry.path);
    }
  };

  const handleConfirm = () => {
    if (mode === "directory") {
      onSelect(currentPath);
    } else if (selectedEntry) {
      onSelect(selectedEntry);
    } else if (mode === "any") {
      onSelect(currentPath);
    }
  };

  const canConfirm =
    mode === "directory" || mode === "any" || selectedEntry !== null;

  const modeLabel =
    mode === "directory" ? "folder" : mode === "file" ? "file" : "file or folder";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg gap-3">
        <DialogHeader>
          <DialogTitle>Select {modeLabel}</DialogTitle>
          <DialogDescription>
            Browse and select a {modeLabel} on the server.
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
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              onBlur={handlePathSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePathSubmit();
                if (e.key === "Escape") {
                  setEditingPath(false);
                  setInputPath(currentPath);
                }
              }}
              autoFocus
            />
          ) : (
            <PickerBreadcrumb
              path={currentPath}
              onClick={() => {
                setEditingPath(true);
                setInputPath(currentPath);
              }}
              onNavigate={(p) => void loadDirectory(p)}
            />
          )}
        </div>

        {/* File listing */}
        <ScrollArea className="h-[320px] rounded-md border">
          {isLoading ? (
            <div className="flex h-full items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-16">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadDirectory(currentPath, false)}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="p-1">
              {entries.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {mode === "directory" ? "No subdirectories" : "Empty directory"}
                </p>
              ) : (
                entries.map((entry) => {
                  const isSelected = selectedEntry === entry.path;
                  const isDir = entry.type === "directory";
                  return (
                    <button
                      key={entry.path}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        isSelected
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent"
                      )}
                      onClick={() => handleEntryClick(entry)}
                      onDoubleClick={() => handleEntryDoubleClick(entry)}
                    >
                      {isDir ? (
                        <Folder className="size-4 shrink-0 text-amber-500" />
                      ) : (
                        <File className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate text-left"
                        title={entry.name}
                      >
                        {entry.name}
                      </span>
                      {isDir && (
                        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </ScrollArea>

        {/* Selected path display */}
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {mode === "directory" ? "Folder:" : "Selected:"}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {selectedEntry || currentPath}
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Breadcrumb for the picker ───────────────────────────────────

function PickerBreadcrumb({
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

  // Auto-scroll to end when path changes
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
                isLast
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
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
