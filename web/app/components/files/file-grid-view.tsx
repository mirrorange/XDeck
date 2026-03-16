import { useEffect } from "react";
import { motion } from "motion/react";

import { FileIcon } from "~/components/files/file-icon";
import { Checkbox } from "~/components/ui/checkbox";
import { truncateMiddleFilename } from "~/lib/file-utils";
import { useFileStore, type FileEntry } from "~/stores/file-store";
import { useFileDnd } from "~/lib/dnd-utils";
import { useTouchDragSelect } from "~/hooks/use-touch-drag-select";
import { cn } from "~/lib/utils";

interface FileGridViewProps {
  tabId: string;
  entries: FileEntry[];
  selectedPaths: Set<string>;
  isMobile?: boolean;
  multiSelectMode?: boolean;
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onDropFiles?: (targetDir: string, sourcePaths: string[]) => void;
  onLongPress?: (entry: FileEntry) => void;
  onToggleSelect?: (entry: FileEntry) => void;
  onDragSelect?: (paths: Set<string>) => void;
}

export function FileGridView({
  tabId,
  entries,
  selectedPaths,
  isMobile,
  multiSelectMode,
  onOpen,
  onContextMenu,
  onDropFiles,
  onLongPress,
  onToggleSelect,
  onDragSelect,
}: FileGridViewProps) {
  const { selectFile, selectRange } = useFileStore();

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
    if (isMobile) {
      onOpen(entry);
      return;
    }
    if (e.shiftKey) {
      selectRange(tabId, entry.path);
    } else {
      selectFile(tabId, entry.path, e.metaKey || e.ctrlKey);
    }
  };

  if (entries.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        This folder is empty
      </div>
    );
  }

  return (
    <div
      className="grid gap-2 p-2 sm:gap-3 sm:p-3"
      style={{
        gridTemplateColumns:
          "repeat(auto-fit, minmax(clamp(7rem, 22vw, 9.5rem), 1fr))",
      }}
    >
      {entries.map((entry, index) => {
        const isSelected = selectedPaths.has(entry.path);
        const isDragOver = dragOverPath === entry.path;
        return (
          <motion.div
            key={entry.path}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.15, delay: Math.min(index * 0.008, 0.3) }}
          >
            <button
              draggable={!isMobile}
              data-lasso-item
              data-path={entry.path}
              className={cn(
                "relative flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl p-3 text-center transition-colors sm:min-h-28",
                "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected && "bg-accent",
                isDragOver && "bg-primary/10 ring-2 ring-primary/30",
                "select-none cursor-default"
              )}
              onClick={(e) => handleClick(e, entry)}
              onDoubleClick={!isMobile && !multiSelectMode ? () => onOpen(entry) : undefined}
              onContextMenu={(e) => onContextMenu(e, entry)}
              onTouchStart={isMobile ? (e) => touchDragStart(entry, index, e) : undefined}
              onTouchEnd={isMobile ? touchDragEnd : undefined}
              onDragStart={!isMobile ? (e) => handleDragStart(e, entry) : undefined}
              onDragEnd={!isMobile ? handleDragEnd : undefined}
              onDragOver={!isMobile ? (e) => handleDragOver(e, entry) : undefined}
              onDragLeave={!isMobile ? handleDragLeave : undefined}
              onDrop={!isMobile ? (e) => handleDrop(e, entry) : undefined}
            >
              {multiSelectMode && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect?.(entry)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-2 right-2"
                />
              )}
              <FileIcon
                type={entry.type}
                name={entry.name}
                className="size-10 sm:size-11"
              />
              <span
                className={cn(
                  "line-clamp-2 w-full break-words text-xs leading-tight sm:text-sm",
                  entry.hidden && "text-muted-foreground"
                )}
                title={entry.name}
              >
                {truncateMiddleFilename(entry.name, 26)}
              </span>
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}
