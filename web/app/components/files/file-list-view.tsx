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
import { cn } from "~/lib/utils";

interface FileListViewProps {
  tabId: string;
  entries: FileEntry[];
  selectedPaths: Set<string>;
  sortField: SortField;
  sortDirection: "asc" | "desc";
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onDropFiles?: (targetDir: string) => void;
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

  const handleDragStart = (e: React.DragEvent, entry: FileEntry) => {
    // If the dragged item is not selected, select it
    if (!selectedPaths.has(entry.path)) {
      selectFile(tabId, entry.path, false);
    }
    const paths = selectedPaths.has(entry.path)
      ? [...selectedPaths]
      : [entry.path];
    e.dataTransfer.setData("application/x-xdeck-files", JSON.stringify(paths));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, entry: FileEntry) => {
    if (entry.type !== "directory") return;
    if (e.dataTransfer.types.includes("application/x-xdeck-files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleDrop = (e: React.DragEvent, entry: FileEntry) => {
    if (entry.type !== "directory") return;
    e.preventDefault();
    const data = e.dataTransfer.getData("application/x-xdeck-files");
    if (data) {
      onDropFiles?.(entry.path);
    }
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
        {entries.map((entry) => {
          const isSelected = selectedPaths.has(entry.path);
          return (
            <TableRow
              key={entry.path}
              data-state={isSelected ? "selected" : undefined}
              className={cn(
                "cursor-default select-none",
                isSelected && "bg-accent"
              )}
              draggable
              onClick={(e) => handleClick(e, entry)}
              onDoubleClick={() => handleDoubleClick(entry)}
              onContextMenu={(e) => onContextMenu(e, entry)}
              onDragStart={(e) => handleDragStart(e, entry)}
              onDragOver={(e) => handleDragOver(e, entry)}
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
