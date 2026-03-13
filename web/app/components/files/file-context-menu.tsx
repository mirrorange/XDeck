import {
  Copy,
  Download,
  Edit,
  FileArchive,
  FolderPlus,
  Info,
  Move,
  RefreshCw,
  Scissors,
  ListChecks,
  Trash2,
  Upload,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import type { FileEntry } from "~/stores/file-store";

export type FileAction =
  | "open"
  | "rename"
  | "copy"
  | "move"
  | "delete"
  | "download"
  | "upload"
  | "new-folder"
  | "refresh"
  | "select-all"
  | "properties"
  | "compress"
  | "extract";

interface FileContextMenuProps {
  children: React.ReactNode;
  entry?: FileEntry | null;
  hasSelection: boolean;
  selectionCount: number;
  onAction: (action: FileAction) => void;
}

export function FileContextMenu({
  children,
  entry,
  hasSelection,
  selectionCount,
  onAction,
}: FileContextMenuProps) {
  const isFile = entry && entry.type === "file";
  const isDir = entry && entry.type === "directory";
  const isArchive =
    isFile &&
    /\.(zip|tar|gz|bz2|xz|7z|rar|tgz)$/i.test(entry.name);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {entry ? (
          <>
            <ContextMenuItem onSelect={() => onAction("open")}>
              <Edit className="mr-2 size-4" />
              Open
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onAction("rename")}>
              <Edit className="mr-2 size-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onAction("copy")}>
              <Copy className="mr-2 size-4" />
              Copy
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onAction("move")}>
              <Move className="mr-2 size-4" />
              Move to…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onAction("download")}>
              <Download className="mr-2 size-4" />
              Download{selectionCount > 1 ? ` (${selectionCount} items)` : ""}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onAction("compress")}>
              <FileArchive className="mr-2 size-4" />
              Compress
            </ContextMenuItem>
            {isArchive && (
              <ContextMenuItem onSelect={() => onAction("extract")}>
                <FileArchive className="mr-2 size-4" />
                Extract Here
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onAction("properties")}>
              <Info className="mr-2 size-4" />
              Properties
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => onAction("delete")}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-4" />
              Delete{selectionCount > 1 ? ` (${selectionCount} items)` : ""}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => onAction("new-folder")}>
              <FolderPlus className="mr-2 size-4" />
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onAction("upload")}>
              <Upload className="mr-2 size-4" />
              Upload Files
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onAction("refresh")}>
              <RefreshCw className="mr-2 size-4" />
              Refresh
            </ContextMenuItem>
            {hasSelection && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onAction("select-all")}>
                  <ListChecks className="mr-2 size-4" />
                  Select All
                </ContextMenuItem>
              </>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
