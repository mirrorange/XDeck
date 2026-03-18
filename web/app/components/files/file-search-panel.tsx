import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import { Checkbox } from "~/components/ui/checkbox";
import { FileContextMenu, type FileAction } from "~/components/files/file-context-menu";
import { FileIcon } from "~/components/files/file-icon";
import { MobileSelectionBar } from "~/components/files/mobile-selection-bar";
import { MobileSelectionHeader } from "~/components/files/mobile-selection-header";
import { useContextMenuGuard } from "~/hooks/use-context-menu-guard";
import { useTouchDragSelect } from "~/hooks/use-touch-drag-select";
import { startFileDrag } from "~/lib/dnd-utils";
import { formatFileSize, truncateMiddleFilename } from "~/lib/file-utils";
import { getRpcClient } from "~/lib/rpc-client";
import { cn } from "~/lib/utils";
import type { FileEntry } from "~/stores/file-store";

interface FileSearchActionContext {
  entry: FileEntry;
  selectedEntries: FileEntry[];
}

interface FileSearchPanelProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onAction: (action: FileAction, payload: FileSearchActionContext) => void;
  onClose: () => void;
  className?: string;
}

export function FileSearchPanel({
  currentPath,
  onNavigate,
  onAction,
  onClose,
  className,
}: FileSearchPanelProps) {
  const dragPreviewCleanupRef = useRef<(() => void) | null>(null);
  const [query, setQuery] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [results, setResults] = useState<FileEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [contextMenuContentKey, setContextMenuContentKey] = useState(0);
  const { rememberPointerType, shouldSuppressContextMenu } = useContextMenuGuard();

  const handleOpenResult = useCallback(
    (entry: FileEntry) => {
      if (entry.type === "directory") {
        onNavigate(entry.path);
      } else {
        const parent = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
        onNavigate(parent);
      }
      onClose();
    },
    [onClose, onNavigate]
  );

  const handleLongPress = useCallback((entry: FileEntry) => {
    setMultiSelectMode(true);
    setSelectedPaths(new Set([entry.path]));
  }, []);

  const handleDragSelect = useCallback((paths: Set<string>) => {
    setSelectedPaths(new Set(paths));
  }, []);

  const {
    handleTouchStart,
    handleTouchEnd,
    longPressFiredRef,
    setPreSelection,
  } = useTouchDragSelect({
    entries: results,
    multiSelectMode,
    enabled: true,
    onDragSelect: handleDragSelect,
    onLongPress: handleLongPress,
    itemSelector: "[data-search-result-item]",
  });

  useEffect(() => {
    setPreSelection(selectedPaths);
  }, [selectedPaths, setPreSelection]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setMultiSelectMode(false);
  }, []);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setSearched(true);
    clearSelection();

    try {
      const rpc = getRpcClient();
      const result = (await rpc.call("fs.search", {
        path: currentPath,
        pattern: trimmed,
        recursive,
        max_results: 200,
      })) as { results: FileEntry[]; total: number };
      setResults(result.results);
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [clearSelection, currentPath, query, recursive]);

  const handleToggleSelect = useCallback((entry: FileEntry) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      return next;
    });
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        e.preventDefault();
        return;
      }

      if (multiSelectMode) {
        handleToggleSelect(entry);
        return;
      }

      handleOpenResult(entry);
    },
    [handleOpenResult, handleToggleSelect, longPressFiredRef, multiSelectMode]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      if (shouldSuppressContextMenu()) {
        e.preventDefault();
        return;
      }

      setContextMenuContentKey((current) => current + 1);
      setSelectedPaths((current) =>
        current.has(entry.path) ? current : new Set([entry.path])
      );
    },
    [shouldSuppressContextMenu]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, entry: FileEntry) => {
      dragPreviewCleanupRef.current = startFileDrag(e, {
        entry,
        entries: results,
        selectedPaths,
      });
    },
    [results, selectedPaths]
  );

  const handleDragEnd = useCallback(() => {
    dragPreviewCleanupRef.current?.();
    dragPreviewCleanupRef.current = null;
  }, []);

  const selectedEntries = results.filter((entry) => selectedPaths.has(entry.path));
  const searchSelectionActive = multiSelectMode;

  const handleActionRequest = useCallback(
    (action: FileAction, entry?: FileEntry) => {
      const actionEntry = entry ?? selectedEntries[0];
      const actionEntries = entry
        ? selectedPaths.has(entry.path)
          ? selectedEntries
          : [entry]
        : selectedEntries;

      if (!actionEntry || actionEntries.length === 0) return;
      onAction(action, { entry: actionEntry, selectedEntries: actionEntries });
    },
    [onAction, selectedEntries, selectedPaths]
  );

  return (
    <div
      className={cn("flex h-full w-full min-w-0 flex-col bg-background", className)}
      onPointerDownCapture={(e) => rememberPointerType(e.pointerType)}
      onTouchStartCapture={() => rememberPointerType("touch")}
      onContextMenuCapture={(e) => {
        if (shouldSuppressContextMenu()) {
          e.preventDefault();
        }
      }}
    >
      {searchSelectionActive ? (
        <MobileSelectionHeader
          selectionCount={selectedPaths.size}
          totalCount={results.length}
          onExitSelection={clearSelection}
          onSelectAll={() => {
            if (selectedPaths.size === results.length) {
              setSelectedPaths(new Set());
            } else {
              setSelectedPaths(new Set(results.map((entry) => entry.path)));
            }
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <Search className="size-4" />
              <span className="text-sm font-medium">Search</span>
            </div>
            <Button variant="ghost" size="icon" className="size-8" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>

          <div className="space-y-2 border-b p-3">
            <div className="flex gap-1.5">
              <Input
                className="h-9 text-sm"
                placeholder="Search files…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
                autoFocus
              />
              <Button
                size="sm"
                className="h-9 px-3"
                onClick={() => void handleSearch()}
                disabled={!query.trim() || isSearching}
              >
                {isSearching ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="recursive"
                checked={recursive}
                onCheckedChange={setRecursive}
                className="h-4 w-8"
              />
              <Label htmlFor="recursive" className="text-xs text-muted-foreground">
                Search subdirectories
              </Label>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              In: {currentPath}
            </p>
          </div>
        </>
      )}

      <ScrollArea
        className="flex-1"
        onClick={(e) => {
          if (multiSelectMode) return;
          const target = e.target as HTMLElement;
          if (!target.closest("[data-search-result-item]")) {
            setSelectedPaths(new Set());
          }
        }}
      >
        {isSearching ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : searched && results.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No results found
          </div>
        ) : (
          <div className="p-1">
            {results.map((entry, index) => {
              const isSelected = selectedPaths.has(entry.path);
              const actionEntries = isSelected ? selectedEntries : [entry];

              return (
                <FileContextMenu
                  key={entry.path}
                  contentKey={contextMenuContentKey}
                  entry={entry}
                  hasSelection={actionEntries.length > 0}
                  selectionCount={actionEntries.length}
                  onAction={(action) => handleActionRequest(action, entry)}
                >
                  <button
                    type="button"
                    draggable={!multiSelectMode}
                    data-search-result-item
                    data-path={entry.path}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                      "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected && "bg-accent"
                    )}
                    onClick={(e) => handleClick(e, entry)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                    onTouchStart={(e) => handleTouchStart(entry, index, e)}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                    onDragStart={!multiSelectMode ? (e) => handleDragStart(e, entry) : undefined}
                    onDragEnd={!multiSelectMode ? handleDragEnd : undefined}
                    style={{ WebkitTouchCallout: "none" }}
                  >
                    {searchSelectionActive && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleSelect(entry)}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                    )}
                    <FileIcon
                      type={entry.type}
                      name={entry.name}
                      className="size-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate" title={entry.name}>
                        {truncateMiddleFilename(entry.name, 32)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.path}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {entry.type === "directory" ? "Folder" : formatFileSize(entry.size)}
                    </span>
                  </button>
                </FileContextMenu>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {searched && results.length > 0 && !searchSelectionActive && (
        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          {results.length} result{results.length !== 1 ? "s" : ""}
        </div>
      )}

      {searchSelectionActive && (
        <MobileSelectionBar
          selectionCount={selectedPaths.size}
          onAction={handleActionRequest}
        />
      )}
    </div>
  );
}
