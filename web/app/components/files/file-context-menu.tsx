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
import { useRef } from "react";

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
  contentKey?: number;
  hasSelection: boolean;
  selectionCount: number;
  onAction: (action: FileAction) => void;
}

export function FileContextMenu({
  children,
  entry,
  contentKey,
  hasSelection,
  selectionCount,
  onAction,
}: FileContextMenuProps) {
  const openedAtRef = useRef(0);
  const ignoreFirstSelectRef = useRef(false);
  const isFile = entry && entry.type === "file";
  const isDir = entry && entry.type === "directory";
  const isArchive =
    isFile &&
    /\.(zip|tar|gz|bz2|xz|7z|rar|tgz)$/i.test(entry.name);

  const handleSelect = (
    event: Event,
    action: FileAction
  ) => {
    const elapsed = performance.now() - openedAtRef.current;

    // Prevent accidental action firing from the same pointer event used to open the menu.
    if (ignoreFirstSelectRef.current && elapsed < 180) {
      event.preventDefault();
      ignoreFirstSelectRef.current = false;
      return;
    }

    ignoreFirstSelectRef.current = false;
    onAction(action);
  };

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) {
          openedAtRef.current = performance.now();
          ignoreFirstSelectRef.current = true;
        }
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent key={contentKey} className="w-56">
        {entry ? (
          <>
            <ContextMenuItem onSelect={(e) => handleSelect(e, "open")}>
              <Edit className="mr-2 size-4" />
              Open
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={(e) => handleSelect(e, "rename")}>
              <Edit className="mr-2 size-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={(e) => handleSelect(e, "copy")}>
              <Copy className="mr-2 size-4" />
              Copy
            </ContextMenuItem>
            <ContextMenuItem onSelect={(e) => handleSelect(e, "move")}>
              <Move className="mr-2 size-4" />
              Move to…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={(e) => handleSelect(e, "download")}>
              <Download className="mr-2 size-4" />
              Download{selectionCount > 1 ? ` (${selectionCount} items)` : ""}
            </ContextMenuItem>
            <ContextMenuItem onSelect={(e) => handleSelect(e, "compress")}>
              <FileArchive className="mr-2 size-4" />
              Compress
            </ContextMenuItem>
            {isArchive && (
              <ContextMenuItem onSelect={(e) => handleSelect(e, "extract")}>
                <FileArchive className="mr-2 size-4" />
                Extract Here
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={(e) => handleSelect(e, "properties")}>
              <Info className="mr-2 size-4" />
              Properties
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={(e) => handleSelect(e, "delete")}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-4" />
              Delete{selectionCount > 1 ? ` (${selectionCount} items)` : ""}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={(e) => handleSelect(e, "new-folder")}>
              <FolderPlus className="mr-2 size-4" />
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={(e) => handleSelect(e, "upload")}>
              <Upload className="mr-2 size-4" />
              Upload Files
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={(e) => handleSelect(e, "refresh")}>
              <RefreshCw className="mr-2 size-4" />
              Refresh
            </ContextMenuItem>
            {hasSelection && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={(e) => handleSelect(e, "select-all")}>
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
