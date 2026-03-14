import {
  ArrowDown,
  ArrowUp,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { FileIcon } from "~/components/files/file-icon";
import { formatFileSize, formatDate, formatPermissions } from "~/lib/file-utils";
import { useFileStore, type FileEntry, type SortField } from "~/stores/file-store";
import { useFileDnd } from "~/lib/dnd-utils";
import { cn } from "~/lib/utils";

interface FileListViewProps {
  tabId: string;
  entries: FileEntry[];
  selectedPaths: Set<string>;
  sortField: SortField;
  sortDirection: "asc" | "desc";
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onDropFiles?: (targetDir: string, sourcePaths: string[]) => void;
}

export function FileListView({
  tabId,
  entries,
  selectedPaths,
  sortField,
  sortDirection,
  onOpen,
  onContextMenu,
  onDropFiles,
}: FileListViewProps) {
  const { selectFile, selectRange, setSortField } = useFileStore();

  const { handleDragStart, handleDragEnd, handleDragOver, handleDragLeave, handleDrop, dragOverPath } = useFileDnd({
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

  const handleDoubleClick = (entry: FileEntry) => {
    onOpen(entry);
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
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead
            className="w-[50%] cursor-pointer select-none"
            onClick={() => setSortField(tabId, "name")}
          >
            Name <SortIcon field="name" />
          </TableHead>
          <TableHead
            className="w-[15%] cursor-pointer select-none"
            onClick={() => setSortField(tabId, "size")}
          >
            Size <SortIcon field="size" />
          </TableHead>
          <TableHead
            className="w-[20%] cursor-pointer select-none"
            onClick={() => setSortField(tabId, "modified")}
          >
            Modified <SortIcon field="modified" />
          </TableHead>
          <TableHead className="w-[15%]">Permissions</TableHead>
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
              style={{ animationDelay: `${delay}ms` }}
              draggable
              onClick={(e) => handleClick(e, entry)}
              onDoubleClick={() => handleDoubleClick(entry)}
              onContextMenu={(e) => onContextMenu(e, entry)}
              onDragStart={(e) => handleDragStart(e, entry)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, entry)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, entry)}
            >
              <TableCell className="py-1.5">
                <div className="flex items-center gap-2">
                  <FileIcon
                    type={entry.type}
                    name={entry.name}
                    className="size-4 shrink-0"
                  />
                  <span
                    className={cn(
                      "truncate",
                      entry.hidden && "text-muted-foreground"
                    )}
                  >
                    {entry.name}
                  </span>
                  {entry.symlink_target && (
                    <span className="text-xs text-muted-foreground truncate">
                      → {entry.symlink_target}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="py-1.5 text-muted-foreground tabular-nums">
                {entry.type === "directory" ? "—" : formatFileSize(entry.size)}
              </TableCell>
              <TableCell className="py-1.5 text-muted-foreground">
                {formatDate(entry.modified)}
              </TableCell>
              <TableCell className="py-1.5 text-muted-foreground font-mono text-xs">
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
