import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "~/components/responsive-modal";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import {
  SNIPPET_EXECUTION_MODE_OPTIONS,
  type SnippetExecutionMode,
} from "~/lib/snippet-execution";
import { useSnippetStore, type SnippetInfo } from "~/stores/snippet-store";

interface SnippetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snippet?: SnippetInfo | null;
}

export function SnippetFormDialog({ open, onOpenChange, snippet }: SnippetFormDialogProps) {
  const { createSnippet, updateSnippet } = useSnippetStore();

  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [executionMode, setExecutionMode] = useState<SnippetExecutionMode>("paste_and_run");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isEdit = !!snippet;

  // Reset form when opening or snippet changes
  useEffect(() => {
    if (open) {
      setName(snippet?.name ?? "");
      setCommand(snippet?.command ?? "");
      setExecutionMode(snippet?.execution_mode ?? "paste_and_run");
      setTags(snippet?.tags ?? []);
      setTagInput("");
      setIsSaving(false);
      // Focus name input after open animation
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [open, snippet]);

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput("");
  }, [tagInput, tags]);

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleTagKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !command) return;

    setIsSaving(true);
    try {
      if (isEdit && snippet) {
        await updateSnippet({
          id: snippet.id,
          name: name.trim(),
          command,
          execution_mode: executionMode,
          tags,
        });
      } else {
        await createSnippet({
          name: name.trim(),
          command,
          execution_mode: executionMode,
          tags,
        });
      }
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to save snippet:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{isEdit ? "Edit Snippet" : "New Snippet"}</ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 md:px-0">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="snippet-name">Name</Label>
            <Input
              ref={nameInputRef}
              id="snippet-name"
              placeholder="e.g. Deploy to production"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Command */}
          <div className="space-y-2">
            <Label htmlFor="snippet-command">
              Command
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                (multiline supported)
              </span>
            </Label>
            <Textarea
              id="snippet-command"
              placeholder={"echo \"Hello World\"\nls -la"}
              className="min-h-24 font-mono text-sm"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="snippet-execution-mode">Default behavior</Label>
            <Select
              value={executionMode}
              onValueChange={(value) => setExecutionMode(value as SnippetExecutionMode)}
            >
              <SelectTrigger id="snippet-execution-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SNIPPET_EXECUTION_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {
                SNIPPET_EXECUTION_MODE_OPTIONS.find((option) => option.value === executionMode)
                  ?.description
              }
            </p>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="snippet-tags">Tags</Label>
            <div className="flex flex-wrap items-center gap-1 rounded-md border px-2 py-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="h-5 gap-0.5 pl-1.5 pr-0.5 text-xs">
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  >
                    <X className="size-2.5" />
                  </button>
                </Badge>
              ))}
              <Input
                id="snippet-tags"
                className="h-5 min-w-16 flex-1 border-0 px-0 py-0 text-xs shadow-none focus-visible:ring-0"
                placeholder={tags.length === 0 ? "Add tags…" : ""}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
              />
            </div>
          </div>
        </div>

        <ResponsiveModalFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !command || isSaving}
          >
            {isSaving ? "Saving…" : isEdit ? "Save Changes" : "Create"}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
