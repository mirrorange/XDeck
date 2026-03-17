import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Download,
  Edit,
  Ellipsis,
  Eye,
  EyeOff,
  FileArchive,
  FolderPlus,
  Grid3X3,
  Info,
  List,
  Move,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { TaskListToggle } from "~/components/files/task-list-panel";
import type { FileAction } from "~/components/files/file-context-menu";
import { useIsMobile, useMediaQuery } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";
import { useFileStore } from "~/stores/file-store";

interface FileToolbarProps {
  tabId: string;
  path: string;
  canGoBack: boolean;
  canGoForward: boolean;
  selectionCount: number;
  searchPanelOpen?: boolean;
  onSearchToggle?: () => void;
  taskPanelOpen?: boolean;
  onTaskPanelToggle?: () => void;
  onAction: (action: FileAction) => void;
}

export function FileToolbar({
  tabId,
  path,
  canGoBack,
  canGoForward,
  selectionCount,
  searchPanelOpen,
  onSearchToggle,
  taskPanelOpen,
  onTaskPanelToggle,
  onAction,
}: FileToolbarProps) {
  const {
    goBack,
    goForward,
    goUp,
    refresh,
    navigateTo,
    viewMode,
    setViewMode,
    showHidden,
    toggleHidden,
  } = useFileStore();

  const [editingPath, setEditingPath] = useState(false);
  const [inputPath, setInputPath] = useState(path);
  const isCompactLayout = useMediaQuery("(max-width: 1023px)");
  const isMobile = useIsMobile();
  const buttonSizeClass = isCompactLayout ? "size-8" : "size-7";
  const nextViewMode = viewMode === "grid" ? "list" : "grid";

  const handlePathSubmit = () => {
    setEditingPath(false);
    if (inputPath.trim() && inputPath !== path) {
      void navigateTo(tabId, inputPath.trim());
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "border-b px-2",
          isCompactLayout
            ? "flex min-h-12 flex-wrap items-center gap-1.5 py-2"
            : "flex h-10 items-center gap-1"
        )}
      >
        {/* Navigation buttons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSizeClass}
              disabled={!canGoBack}
              onClick={() => goBack(tabId)}
            >
              <ArrowLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSizeClass}
              disabled={!canGoForward}
              onClick={() => goForward(tabId)}
            >
              <ArrowRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Forward</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSizeClass}
              onClick={() => goUp(tabId)}
            >
              <ArrowUp className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Up</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSizeClass}
              onClick={() => refresh(tabId)}
            >
              <RefreshCw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>

        <Separator
          orientation="vertical"
          className={cn("mx-1 !h-4", isCompactLayout && "hidden")}
        />

        {/* Path bar */}
        {editingPath ? (
          <Input
            className={cn(
              "text-sm font-mono",
              isCompactLayout ? "order-last h-9 basis-full" : "h-7 flex-1"
            )}
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            onBlur={handlePathSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePathSubmit();
              if (e.key === "Escape") {
                setEditingPath(false);
                setInputPath(path);
              }
            }}
            autoFocus
          />
        ) : (
          <BreadcrumbPath
            path={path}
            compact={isCompactLayout}
            onClick={() => {
              setEditingPath(true);
              setInputPath(path);
            }}
            onNavigate={(p) => navigateTo(tabId, p)}
          />
        )}

        <Separator
          orientation="vertical"
          className={cn("mx-1 !h-4", isCompactLayout && "hidden")}
        />

        {/* Action buttons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSizeClass}
              onClick={() => onAction("new-folder")}
            >
              <FolderPlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Folder</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSizeClass}
              onClick={() => onAction("upload")}
            >
              <Upload className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Upload</TooltipContent>
        </Tooltip>

        {/* Selection actions dropdown */}
        {!isMobile && selectionCount > 0 && (
          <>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={buttonSizeClass}
                    >
                      <Ellipsis className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Actions ({selectionCount})
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => onAction("download")}>
                  <Download className="mr-2 size-4" />
                  Download
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("rename")}>
                  <Edit className="mr-2 size-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("copy")}>
                  <Copy className="mr-2 size-4" />
                  Copy to…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("move")}>
                  <Move className="mr-2 size-4" />
                  Move to…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAction("compress")}>
                  <FileArchive className="mr-2 size-4" />
                  Compress
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("properties")}>
                  <Info className="mr-2 size-4" />
                  Properties
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onAction("delete")}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        <Separator
          orientation="vertical"
          className={cn("mx-1 !h-4", isCompactLayout && "hidden md:block")}
        />

        {/* Search toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={searchPanelOpen ? "secondary" : "ghost"}
              size="icon"
              className={buttonSizeClass}
              onClick={onSearchToggle}
            >
              <Search className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Search</TooltipContent>
        </Tooltip>

        {/* View toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSizeClass}
              onClick={() => setViewMode(nextViewMode)}
            >
              {viewMode === "grid" ? (
                <Grid3X3 className="size-4" />
              ) : (
                <List className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {viewMode === "grid" ? "Grid view" : "List view"}
          </TooltipContent>
        </Tooltip>

        {/* Hidden files toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSizeClass}
              onClick={toggleHidden}
            >
              {showHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {showHidden ? "Hide hidden files" : "Show hidden files"}
          </TooltipContent>
        </Tooltip>

        {/* Task list toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <TaskListToggle open={taskPanelOpen} onToggle={onTaskPanelToggle} />
          </TooltipTrigger>
          <TooltipContent side="bottom">Tasks</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

// ── Breadcrumb Path ───────────────────────────────────────

interface BreadcrumbPathProps {
  path: string;
  compact?: boolean;
  onClick: () => void;
  onNavigate: (path: string) => void;
}

function BreadcrumbPath({ path, compact = false, onClick, onNavigate }: BreadcrumbPathProps) {
  const parts = path.split("/").filter(Boolean);

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 overflow-x-auto rounded-md bg-muted/50 px-2 cursor-text text-sm",
        compact ? "order-last h-9 basis-full" : "h-7 flex-1"
      )}
      onClick={onClick}
    >
      <button
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors px-1"
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
          <span key={partPath} className="flex items-center gap-0.5 shrink-0">
            <span className="text-muted-foreground/40">/</span>
            <button
              className={`hover:text-foreground transition-colors px-0.5 ${
                isLast ? "text-foreground font-medium" : "text-muted-foreground"
              }`}
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
