import { FileIcon } from "~/components/files/file-icon";
import { useFileStore, type FileEntry } from "~/stores/file-store";
import { useFileDnd } from "~/lib/dnd-utils";
import { cn } from "~/lib/utils";

interface FileGridViewProps {
  tabId: string;
  entries: FileEntry[];
  selectedPaths: Set<string>;
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onDropFiles?: (targetDir: string, sourcePaths: string[]) => void;
}

export function FileGridView({
  tabId,
  entries,
  selectedPaths,
  onOpen,
  onContextMenu,
  onDropFiles,
}: FileGridViewProps) {
  const { selectFile, selectRange } = useFileStore();

  const { handleDragStart, handleDragEnd, handleDragOver, handleDrop } = useFileDnd({
    tabId,
    selectedPaths,
    entries,
    selectFile,
    onDropFiles,
  });

  const handleClick = (e: React.MouseEvent, entry: FileEntry) => {
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-1 p-2">
      {entries.map((entry) => {
        const isSelected = selectedPaths.has(entry.path);
        return (
          <button
            key={entry.path}
            draggable
            data-lasso-item
            data-path={entry.path}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg p-2 text-center transition-colors",
              "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected && "bg-accent",
              "select-none cursor-default"
            )}
            onClick={(e) => handleClick(e, entry)}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(e) => onContextMenu(e, entry)}
            onDragStart={(e) => handleDragStart(e, entry)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, entry)}
            onDrop={(e) => handleDrop(e, entry)}
          >
            <FileIcon
              type={entry.type}
              name={entry.name}
              className="size-10"
            />
            <span
              className={cn(
                "text-xs leading-tight w-full truncate",
                entry.hidden && "text-muted-foreground"
              )}
              title={entry.name}
            >
              {entry.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
