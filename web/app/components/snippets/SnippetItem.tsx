import { useState, useRef } from "react";
import { Copy, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { SnippetInfo } from "~/stores/snippet-store";

interface SnippetItemProps {
  snippet: SnippetInfo;
  onExecute: (command: string) => void;
  onEdit: (snippet: SnippetInfo) => void;
  onDelete: (id: string) => void;
}

/**
 * Format a snippet command for display.
 * Multiline commands (separated by \n) show a preview of the first line + count.
 */
function formatCommandPreview(command: string): string {
  const lines = command.split("\n");
  if (lines.length <= 1) return command;
  return `${lines[0]} (+${lines.length - 1} lines)`;
}

export function SnippetItem({ snippet, onExecute, onEdit, onDelete }: SnippetItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    clearTimeout(deleteTimerRef.current);
    setConfirmDelete(false);
    onDelete(snippet.id);
  };

  const handleCopy = () => {
    const text = snippet.command.replace(/\n/g, "\r\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const lineCount = snippet.command.split("\n").length;

  return (
    <div className="group rounded-md border bg-card p-2 transition-colors hover:bg-accent/50">
      {/* Header row */}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium leading-tight">{snippet.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => onExecute(snippet.command)}
                >
                  <Play className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Run in terminal</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100"
              >
                <MoreHorizontal className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={() => onExecute(snippet.command)}>
                <Play className="mr-2 size-3.5" />
                Run
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopy}>
                <Copy className="mr-2 size-3.5" />
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(snippet)}>
                <Pencil className="mr-2 size-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="mr-2 size-3.5" />
                {confirmDelete ? "Confirm Delete" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Command preview */}
      <div
        className="mt-1 cursor-pointer rounded bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-snug text-muted-foreground"
        onClick={() => onExecute(snippet.command)}
        title="Click to run"
      >
        <span className="line-clamp-2 break-all">{formatCommandPreview(snippet.command)}</span>
      </div>

      {/* Tags + meta */}
      {(snippet.tags.length > 0 || lineCount > 1) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {lineCount > 1 && (
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {lineCount} lines
            </Badge>
          )}
          {snippet.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="h-4 px-1 text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
