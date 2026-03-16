import {
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { useEffect, useRef } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { FileIcon } from "~/components/files/file-icon";
import { Checkbox } from "~/components/ui/checkbox";
import {
  formatFileSize,
  formatDate,
  formatPermissions,
  truncateMiddleFilename,
} from "~/lib/file-utils";
import { useFileStore, type FileEntry, type SortField } from "~/stores/file-store";
import { useFileDnd } from "~/lib/dnd-utils";
import { useTouchDragSelect } from "~/hooks/use-touch-drag-select";
import { cn } from "~/lib/utils";

interface FileListViewProps {
  tabId: string;
  entries: FileEntry[];
  selectedPaths: Set<string>;
  sortField: SortField;
  sortDirection: "asc" | "desc";
  isMobile?: boolean;
  multiSelectMode?: boolean;
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onDropFiles?: (targetDir: string, sourcePaths: string[]) => void;
  onLongPress?: (entry: FileEntry) => void;
  onToggleSelect?: (entry: FileEntry) => void;
  onDragSelect?: (paths: Set<string>) => void;
}

export function FileListView({
  tabId,
  entries,
  selectedPaths,
  sortField,
  sortDirection,
  isMobile,
  multiSelectMode,
  onOpen,
  onContextMenu,
  onDropFiles,
  onLongPress,
  onToggleSelect,
  onDragSelect,
}: FileListViewProps) {
  const { selectFile, selectRange, setSortField } = useFileStore();
  const lastInteractionTypeRef = useRef<"mouse" | "touch" | "pen" | null>(null);

  const { handleDragStart, handleDragEnd, handleDragOver, handleDragLeave, handleDrop, dragOverPath } = useFileDnd({
    tabId,
    selectedPaths,
    entries,
    selectFile,
    onDropFiles,
  });

  const {
    handleTouchStart: touchDragStart,
    handleTouchEnd: touchDragEnd,
    longPressFiredRef,
    setPreSelection,
  } = useTouchDragSelect({
    entries,
    multiSelectMode: !!multiSelectMode,
    isMobile: !!isMobile,
    onDragSelect: onDragSelect ?? (() => {}),
    onLongPress: onLongPress ?? (() => {}),
    itemSelector: "[data-lasso-item]",
  });

  // Keep pre-selection in sync so drag can merge with existing selection
  useEffect(() => {
    setPreSelection(selectedPaths);
  }, [selectedPaths, setPreSelection]);

  const handleClick = (e: React.MouseEvent, entry: FileEntry) => {
    // Suppress click after long press or drag select
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      e.preventDefault();
      return;
    }
    if (multiSelectMode) {
      onToggleSelect?.(entry);
      return;
    }

    if (lastInteractionTypeRef.current === "touch" || lastInteractionTypeRef.current === "pen") {
      // Direct pointers open on tap, while mouse clicks keep their selection behavior.
      onOpen(entry);
      return;
    }

    if (e.shiftKey) {
      selectRange(tabId, entry.path);
    } else {
      selectFile(tabId, entry.path, e.metaKey || e.ctrlKey);
    }
  };

  const handleDoubleClick = (entry: FileEntry) => {
    if (multiSelectMode) return;
    onOpen(entry);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || e.pointerType === "touch" || e.pointerType === "pen") {
      lastInteractionTypeRef.current = e.pointerType;
    }
  };

  const handleTouchStart = (entry: FileEntry, index: number, e: React.TouchEvent) => {
    lastInteractionTypeRef.current = "touch";
    touchDragStart(entry, index, e);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === "asc" ? (
      <ArrowUp className="inline size-3 ml-0.5" />
    ) : (
      <ArrowDown className="inline size-3 ml-0.5" />
    );
  };

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead
            className="w-[50%] cursor-pointer select-none"
            onClick={() => setSortField(tabId, "name")}
          >
            Name <SortIcon field="name" />
          </TableHead>
          <TableHead
            className="hidden w-[15%] cursor-pointer select-none sm:table-cell"
            onClick={() => setSortField(tabId, "size")}
          >
            Size <SortIcon field="size" />
          </TableHead>
          <TableHead
            className="hidden w-[20%] cursor-pointer select-none md:table-cell"
            onClick={() => setSortField(tabId, "modified")}
          >
            Modified <SortIcon field="modified" />
          </TableHead>
          <TableHead className="hidden w-[15%] lg:table-cell">Permissions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry, index) => {
          const isSelected = selectedPaths.has(entry.path);
          const isDragOver = dragOverPath === entry.path;
          // Staggered fade-in via CSS animation delay (capped at 300ms total)
          const delay = Math.min(index * 10, 300);
          return (
            <TableRow
              key={entry.path}
              data-state={isSelected ? "selected" : undefined}
              data-lasso-item
              data-path={entry.path}
              className={cn(
                "cursor-default select-none animate-in fade-in slide-in-from-bottom-1 duration-150 fill-mode-both",
                isSelected && "bg-accent",
                isDragOver && "bg-primary/10 ring-1 ring-inset ring-primary/30"
              )}
              draggable={!isMobile}
              onPointerDown={handlePointerDown}
              onClick={(e) => handleClick(e, entry)}
              onDoubleClick={() => handleDoubleClick(entry)}
              onContextMenu={(e) => onContextMenu(e, entry)}
              onTouchStart={isMobile ? (e) => handleTouchStart(entry, index, e) : undefined}
              onTouchEnd={isMobile ? touchDragEnd : undefined}
              onTouchCancel={isMobile ? touchDragEnd : undefined}
              onDragStart={!isMobile ? (e) => handleDragStart(e, entry) : undefined}
              onDragEnd={!isMobile ? handleDragEnd : undefined}
              onDragOver={!isMobile ? (e) => handleDragOver(e, entry) : undefined}
              onDragLeave={!isMobile ? handleDragLeave : undefined}
              onDrop={!isMobile ? (e) => handleDrop(e, entry) : undefined}
              style={{
                animationDelay: `${delay}ms`,
                WebkitTouchCallout: "none",
              }}
            >
              <TableCell className="py-1.5">
                <div className="flex items-center gap-2 py-1 sm:py-0">
                  {multiSelectMode && (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggleSelect?.(entry)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    />
                  )}
                  <FileIcon
                    type={entry.type}
                    name={entry.name}
                    className="size-4 shrink-0 sm:size-4"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate",
                          entry.hidden && "text-muted-foreground"
                        )}
                        title={entry.name}
                      >
                        {truncateMiddleFilename(entry.name, 44)}
                      </span>
                      {entry.symlink_target && (
                        <span className="truncate text-xs text-muted-foreground">
                          → {entry.symlink_target}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground sm:hidden">
                      <span>{entry.type === "directory" ? "Folder" : formatFileSize(entry.size)}</span>
                      {entry.modified && <span>{formatDate(entry.modified)}</span>}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden py-1.5 text-muted-foreground tabular-nums sm:table-cell">
                {entry.type === "directory" ? "—" : formatFileSize(entry.size)}
              </TableCell>
              <TableCell className="hidden py-1.5 text-muted-foreground md:table-cell">
                {formatDate(entry.modified)}
              </TableCell>
              <TableCell className="hidden py-1.5 font-mono text-xs text-muted-foreground lg:table-cell">
                {formatPermissions(entry.mode)}
              </TableCell>
            </TableRow>
          );
        })}
        {entries.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
              This folder is empty
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
