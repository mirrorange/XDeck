import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  Grid3X3,
  List,
  RefreshCw,
  Search,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { useFileStore, type ViewMode } from "~/stores/file-store";

interface FileToolbarProps {
  tabId: string;
  path: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onSearchToggle?: () => void;
}

export function FileToolbar({ tabId, path, canGoBack, canGoForward, onSearchToggle }: FileToolbarProps) {
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


  const handlePathSubmit = () => {
    setEditingPath(false);
    if (inputPath.trim() && inputPath !== path) {
      void navigateTo(tabId, inputPath.trim());
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-10 items-center gap-1 border-b px-2">
        {/* Navigation buttons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
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
              className="size-7"
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
              className="size-7"
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
              className="size-7"
              onClick={() => refresh(tabId)}
            >
              <RefreshCw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="!h-4 mx-1" />

        {/* Path bar */}
        {editingPath ? (
          <Input
            className="h-7 flex-1 text-sm font-mono"
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
            onClick={() => {
              setEditingPath(true);
              setInputPath(path);
            }}
            onNavigate={(p) => navigateTo(tabId, p)}
          />
        )}

        <Separator orientation="vertical" className="!h-4 mx-1" />

        {/* Search toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onSearchToggle}
            >
              <Search className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Search</TooltipContent>
        </Tooltip>

        {/* View toggles */}
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && setViewMode(v as ViewMode)}
          className="gap-0"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="list" className="size-7 p-0">
                <List className="size-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom">List view</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="grid" className="size-7 p-0">
                <Grid3X3 className="size-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom">Grid view</TooltipContent>
          </Tooltip>
        </ToggleGroup>

        {/* Hidden files toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={toggleHidden}
            >
              {showHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {showHidden ? "Hide hidden files" : "Show hidden files"}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

// ── Breadcrumb Path ───────────────────────────────────────

interface BreadcrumbPathProps {
  path: string;
  onClick: () => void;
  onNavigate: (path: string) => void;
}

function BreadcrumbPath({ path, onClick, onNavigate }: BreadcrumbPathProps) {
  const parts = path.split("/").filter(Boolean);

  return (
    <div
      className="flex flex-1 items-center gap-0.5 overflow-x-auto rounded-md bg-muted/50 px-2 h-7 cursor-text text-sm"
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
