import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "~/components/responsive-modal";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useSnippetStore } from "~/stores/snippet-store";
import {
  useSnippetStoreStore,
  type RemoteSnippet,
} from "~/stores/snippet-store-store";

interface SnippetStoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SnippetStoreDialog({ open, onOpenChange }: SnippetStoreDialogProps) {
  const {
    sources,
    results,
    isFetchingSnippets,
    isLoadingSources,
    installingIds,
    fetchSources,
    addSource,
    removeSource,
    fetchRemoteSnippets,
    installSnippet,
  } = useSnippetStoreStore();

  const { fetchSnippets } = useSnippetStore();

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("browse");

  // Source form
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [isAddingSource, setIsAddingSource] = useState(false);

  // Load data on open
  useEffect(() => {
    if (open) {
      void fetchSources();
      void fetchRemoteSnippets();
    }
  }, [open, fetchSources, fetchRemoteSnippets]);

  const allSnippets = results.flatMap((r) =>
    r.snippets.map((s) => ({ ...s, sourceName: r.source.name }))
  );

  const filtered = allSnippets.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q)) ||
      s.author.toLowerCase().includes(q)
    );
  });

  const handleInstall = useCallback(
    async (snippet: RemoteSnippet) => {
      try {
        await installSnippet(snippet);
        await fetchSnippets();
        toast.success(`Installed "${snippet.name}"`);
      } catch (err) {
        toast.error(`Failed to install: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [installSnippet, fetchSnippets]
  );

  const handleAddSource = useCallback(async () => {
    if (!newSourceName.trim() || !newSourceUrl.trim()) return;
    setIsAddingSource(true);
    try {
      await addSource(newSourceName.trim(), newSourceUrl.trim());
      setNewSourceName("");
      setNewSourceUrl("");
      toast.success("Source added");
      void fetchRemoteSnippets();
    } catch (err) {
      toast.error(`Failed to add source: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsAddingSource(false);
    }
  }, [newSourceName, newSourceUrl, addSource, fetchRemoteSnippets]);

  const handleRemoveSource = useCallback(
    async (id: string) => {
      try {
        await removeSource(id);
        toast.success("Source removed");
      } catch (err) {
        toast.error(
          `Failed to remove source: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    [removeSource]
  );

  const handleRefresh = useCallback(() => {
    void fetchRemoteSnippets();
  }, [fetchRemoteSnippets]);

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="w-full sm:max-w-2xl">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <Store className="size-5" />
            Snippet Store
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Browse and install snippets from community sources
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-full">
            <TabsTrigger value="browse" className="flex-1">
              Browse
            </TabsTrigger>
            <TabsTrigger value="sources" className="flex-1">
              Sources
            </TabsTrigger>
          </TabsList>

          {/* ── Browse Tab ─────────────────────────────────── */}
          <TabsContent value="browse" className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search snippets…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isFetchingSnippets}
                className="h-8"
              >
                <RefreshCw
                  className={`size-3.5 ${isFetchingSnippets ? "animate-spin" : ""}`}
                />
              </Button>
            </div>

            <ScrollArea className="flex-1 -mx-6 px-6" style={{ maxHeight: "50vh" }}>
              {isFetchingSnippets && allSnippets.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Loading snippets…</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12">
                  <Store className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {search ? "No matching snippets found" : "No snippets available"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 pb-2">
                  {filtered.map((snippet) => (
                    <SnippetStoreItem
                      key={`${snippet.sourceName}-${snippet.id}`}
                      snippet={snippet}
                      sourceName={snippet.sourceName}
                      isInstalling={installingIds.has(snippet.id)}
                      onInstall={() => handleInstall(snippet)}
                    />
                  ))}
                </div>
              )}

              {/* Source errors */}
              {results
                .filter((r) => r.error)
                .map((r) => (
                  <div
                    key={r.source.id}
                    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div>
                      <p className="font-medium text-destructive">{r.source.name}</p>
                      <p className="text-muted-foreground">{r.error}</p>
                    </div>
                  </div>
                ))}
            </ScrollArea>
          </TabsContent>

          {/* ── Sources Tab ────────────────────────────────── */}
          <TabsContent value="sources" className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Add source form */}
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Add Source</p>
              <div className="grid gap-2">
                <div>
                  <Label htmlFor="source-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="source-name"
                    placeholder="My Snippet Source"
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="source-url" className="text-xs">
                    URL
                  </Label>
                  <Input
                    id="source-url"
                    placeholder="https://example.com/snippets/index.json"
                    value={newSourceUrl}
                    onChange={(e) => setNewSourceUrl(e.target.value)}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleAddSource}
                disabled={isAddingSource || !newSourceName.trim() || !newSourceUrl.trim()}
                className="h-7 text-xs"
              >
                {isAddingSource ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <Plus className="mr-1 size-3" />
                )}
                Add Source
              </Button>
            </div>

            <Separator />

            {/* Source list */}
            <ScrollArea className="flex-1 -mx-6 px-6" style={{ maxHeight: "40vh" }}>
              {isLoadingSources ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : sources.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8">
                  <Globe className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No sources configured</p>
                </div>
              ) : (
                <div className="space-y-2 pb-2">
                  {sources.map((source) => (
                    <div
                      key={source.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">{source.name}</span>
                          {source.id === "official" && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              Official
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground pl-5.5">
                          {source.url}
                        </p>
                      </div>
                      {source.id !== "official" && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleRemoveSource(source.id)}
                          title="Remove source"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

// ── Snippet Item ─────────────────────────────────────────────────

interface SnippetStoreItemProps {
  snippet: RemoteSnippet;
  sourceName: string;
  isInstalling: boolean;
  onInstall: () => void;
}

function SnippetStoreItem({
  snippet,
  sourceName,
  isInstalling,
  onInstall,
}: SnippetStoreItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border p-3 transition-colors hover:bg-muted/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            className="text-left w-full"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{snippet.name}</span>
              {snippet.version && (
                <span className="text-[10px] text-muted-foreground">v{snippet.version}</span>
              )}
            </div>
            {snippet.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {snippet.description}
              </p>
            )}
          </button>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {snippet.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {snippet.author && (
              <span className="text-[10px] text-muted-foreground">by {snippet.author}</span>
            )}
            <span className="text-[10px] text-muted-foreground">• {sourceName}</span>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onInstall}
          disabled={isInstalling}
          className="h-7 shrink-0 text-xs"
        >
          {isInstalling ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <Download className="mr-1 size-3" />
          )}
          Install
        </Button>
      </div>

      {/* Expanded preview */}
      {expanded && (
        <div className="mt-3">
          <Separator className="mb-3" />
          <div className="rounded-md bg-muted/50 p-3">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Command Preview
            </p>
            <pre className="overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap break-all font-mono">
              {snippet.command}
            </pre>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>Mode: {snippet.execution_mode.replace(/_/g, " ")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
