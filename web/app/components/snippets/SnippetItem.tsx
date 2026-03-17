import { useState } from "react";
import {
  Clipboard,
  Copy,
  FileCode2,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  getSnippetExecutionModeLabel,
  type SnippetExecutionMode,
} from "~/lib/snippet-execution";
import type { SnippetInfo } from "~/stores/snippet-store";

interface SnippetItemProps {
  snippet: SnippetInfo;
  onExecute: (snippet: SnippetInfo, executionMode?: SnippetExecutionMode) => void;
  onEdit: (snippet: SnippetInfo) => void;
  onDelete: (id: string) => void;
}

function formatCommandPreview(command: string): string {
  const lines = command.split("\n");
  if (lines.length <= 1) return command;
  return `${lines[0]} (+${lines.length - 1} lines)`;
}

function SnippetModeIcon({ executionMode }: { executionMode: SnippetExecutionMode }) {
  switch (executionMode) {
    case "paste_only":
      return <Clipboard className="size-3" />;
    case "execute_as_script":
      return <FileCode2 className="size-3" />;
    case "paste_and_run":
    default:
      return <Play className="size-3" />;
  }
}

export function SnippetItem({ snippet, onExecute, onEdit, onDelete }: SnippetItemProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleCopy = () => {
    const text = snippet.command.replace(/\n/g, "\r\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const lineCount = snippet.command.split("\n").length;
  const executionModeLabel = getSnippetExecutionModeLabel(snippet.execution_mode);

  return (
    <div className="group rounded-md border bg-card p-2 transition-colors hover:bg-accent/50">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <SnippetModeIcon executionMode={snippet.execution_mode} />
            <span>{executionModeLabel}</span>
          </div>
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
                  onClick={() => onExecute(snippet)}
                >
                  <SnippetModeIcon executionMode={snippet.execution_mode} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{executionModeLabel}</TooltipContent>
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
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onExecute(snippet, "paste_and_run")}>
                <SnippetModeIcon executionMode="paste_and_run" />
                Paste and run
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExecute(snippet, "paste_only")}>
                <SnippetModeIcon executionMode="paste_only" />
                Paste only
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExecute(snippet, "execute_as_script")}>
                <SnippetModeIcon executionMode="execute_as_script" />
                Execute as script
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        className="mt-1 cursor-pointer rounded bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-snug text-muted-foreground"
        onClick={() => onExecute(snippet)}
        title={`Click to ${executionModeLabel.toLowerCase()}`}
      >
        <span className="line-clamp-2 break-all">{formatCommandPreview(snippet.command)}</span>
      </div>

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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Snippet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{snippet.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onDelete(snippet.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
