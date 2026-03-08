import { useState, useCallback } from "react";
import { Plus, Search, Code2, Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useSnippetStore, type SnippetInfo } from "~/stores/snippet-store";
import { SnippetItem } from "./SnippetItem";
import { SnippetFormDialog } from "./SnippetFormDialog";

interface SnippetSidebarProps {
  onExecute: (command: string) => void;
}

export function SnippetSidebar({ onExecute }: SnippetSidebarProps) {
  const { snippets, isLoading, deleteSnippet } = useSnippetStore();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<SnippetInfo | null>(null);

  const filtered = snippets.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.command.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteSnippet(id);
      } catch (err) {
        console.error("Failed to delete snippet:", err);
      }
    },
    [deleteSnippet]
  );

  return (
    <div className="flex h-full w-72 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Code2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Snippets</span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCreateOpen(true)}
          title="New Snippet"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="border-b px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search snippets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading && snippets.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <Code2 className="size-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                {search ? "No matching snippets" : "No snippets yet"}
              </p>
              {!search && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 h-7 text-xs"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="mr-1 size-3" />
                  Create Snippet
                </Button>
              )}
            </div>
          ) : (
            filtered.map((snippet) => (
              <SnippetItem
                key={snippet.id}
                snippet={snippet}
                onExecute={onExecute}
                onEdit={setEditingSnippet}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Create / Edit Dialog */}
      <SnippetFormDialog
        open={createOpen || editingSnippet !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setCreateOpen(false);
            setEditingSnippet(null);
          }
        }}
        snippet={editingSnippet}
      />
    </div>
  );
}
