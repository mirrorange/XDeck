import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Store,
  Tag,
  Trash2,
  User,
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
    fetchSnippetContent,
  } = useSnippetStoreStore();

  const { fetchSnippets } = useSnippetStore();

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("browse");
  const [selectedSnippet, setSelectedSnippet] = useState<RemoteSnippet & { sourceName: string } | null>(null);

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

  // Reset selection when closing
  useEffect(() => {
    if (!open) {
      setSelectedSnippet(null);
      setSearch("");
      setTab("browse");
    }
  }, [open]);

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
        const resolvedCommand = await fetchSnippetContent(snippet);
        await installSnippet(snippet, resolvedCommand || undefined);
        await fetchSnippets();
        toast.success(`Installed "${snippet.name}"`);
      } catch (err) {
        toast.error(`Failed to install: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [installSnippet, fetchSnippets, fetchSnippetContent]
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

  const handleSelectSnippet = useCallback(
    (snippet: RemoteSnippet & { sourceName: string }) => {
      setSelectedSnippet(snippet);
    },
    []
  );

  const handleBack = useCallback(() => {
    setSelectedSnippet(null);
  }, []);

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="w-full sm:max-w-2xl overflow-hidden">
        {selectedSnippet ? (
          /* ── Detail View ─────────────────────────────────────── */
          <SnippetDetailView
            snippet={selectedSnippet}
            isInstalling={installingIds.has(selectedSnippet.id)}
            onInstall={() => handleInstall(selectedSnippet)}
            onBack={handleBack}
            fetchSnippetContent={fetchSnippetContent}
          />
        ) : (
          /* ── List View ───────────────────────────────────────── */
          <>
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
                          onViewDetail={() => handleSelectSnippet(snippet)}
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
          </>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

// ── Snippet List Item ─────────────────────────────────────────────

interface SnippetStoreItemProps {
  snippet: RemoteSnippet;
  sourceName: string;
  isInstalling: boolean;
  onInstall: () => void;
  onViewDetail: () => void;
}

function SnippetStoreItem({
  snippet,
  sourceName,
  isInstalling,
  onInstall,
  onViewDetail,
}: SnippetStoreItemProps) {
  const hasLazyContent = !!snippet.content_url && !snippet.command;

  return (
    <div className="group rounded-lg border bg-card/50 transition-all hover:bg-muted/40 hover:border-border/80">
      <button
        className="w-full text-left p-3 pr-0"
        onClick={onViewDetail}
      >
        <div className="flex items-start justify-between gap-3 pr-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{snippet.name}</span>
              {snippet.version && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  v{snippet.version}
                </span>
              )}
              {hasLazyContent && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 shrink-0">
                  script
                </Badge>
              )}
            </div>
            {snippet.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {snippet.description}
              </p>
            )}

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

          <ChevronRight className="size-3.5 text-muted-foreground/50 mt-0.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </div>
      </button>

      <div className="flex items-center justify-end gap-2 px-3 pb-2.5 -mt-1">
        <Button
          variant="default"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onInstall();
          }}
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
    </div>
  );
}

// ── Snippet Detail View ───────────────────────────────────────────

interface SnippetDetailViewProps {
  snippet: RemoteSnippet & { sourceName: string };
  isInstalling: boolean;
  onInstall: () => void;
  onBack: () => void;
  fetchSnippetContent: (snippet: RemoteSnippet) => Promise<string>;
}

function SnippetDetailView({
  snippet,
  isInstalling,
  onInstall,
  onBack,
  fetchSnippetContent,
}: SnippetDetailViewProps) {
  const [content, setContent] = useState<string | null>(
    snippet.command || null
  );
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load content when the detail view opens (lazy load if needed)
  useEffect(() => {
    if (content !== null) return; // already have inline content
    if (!snippet.content_url) {
      setContent(""); // no content at all
      return;
    }

    setIsLoadingContent(true);
    setContentError(null);

    fetchSnippetContent(snippet)
      .then((c) => {
        setContent(c);
      })
      .catch((err) => {
        setContentError(err instanceof Error ? err.message : "Failed to load content");
      })
      .finally(() => {
        setIsLoadingContent(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippet.id, snippet.content_url]);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const lineCount = content ? content.split("\n").length : 0;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Detail Header */}
      <div className="flex items-start gap-3 pb-4 border-b">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onBack}
          className="mt-0.5 shrink-0"
          title="Back to list"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold leading-tight">{snippet.name}</h2>
            {snippet.version && (
              <Badge variant="secondary" className="text-[10px] px-1.5 font-mono">
                v{snippet.version}
              </Badge>
            )}
          </div>
          {snippet.description && (
            <p className="mt-1 text-sm text-muted-foreground leading-snug">
              {snippet.description}
            </p>
          )}
        </div>

        <Button
          onClick={onInstall}
          disabled={isInstalling || isLoadingContent}
          size="sm"
          className="shrink-0 h-8"
        >
          {isInstalling ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              Installing…
            </>
          ) : (
            <>
              <Download className="mr-1.5 size-3.5" />
              Install
            </>
          )}
        </Button>
      </div>

      <ScrollArea style={{ maxHeight: "calc(80vh - 10rem)" }}>
        <div className="pt-4 space-y-4">
          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {snippet.author && (
              <span className="flex items-center gap-1">
                <User className="size-3" />
                {snippet.author}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Globe className="size-3" />
              {snippet.sourceName}
            </span>
            <span className="flex items-center gap-1 capitalize">
              <ExternalLink className="size-3" />
              {snippet.execution_mode.replace(/_/g, " ")}
            </span>
            {lineCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
            )}
          </div>

          {/* Tags */}
          {snippet.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag className="size-3 text-muted-foreground shrink-0" />
              {snippet.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[11px] px-2 py-0.5">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <Separator />

          {/* Code content */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {snippet.content_url ? "Script Content" : "Command"}
              </p>
              {content && !isLoadingContent && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                >
                  {copied ? (
                    <>
                      <Check className="mr-1 size-3 text-green-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 size-3" />
                      Copy
                    </>
                  )}
                </Button>
              )}
            </div>

            {isLoadingContent ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/30 py-10">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading script…</span>
              </div>
            ) : contentError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium text-destructive">Failed to load content</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{contentError}</p>
                </div>
              </div>
            ) : content ? (
              <div className="relative rounded-lg border bg-muted/30 overflow-hidden">
                {/* Line numbers + code */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono leading-relaxed border-collapse">
                    <tbody>
                      {content.split("\n").map((line, i) => (
                        <tr key={i} className="hover:bg-muted/50 transition-colors">
                          <td className="select-none text-right pr-3 pl-3 py-0.5 text-muted-foreground/40 border-r border-border/40 w-10 min-w-10 text-[10px]">
                            {i + 1}
                          </td>
                          <td className="pl-3 pr-3 py-0.5 whitespace-pre">
                            <span className="text-foreground/90">{line || "\u00a0"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 rounded-lg border bg-muted/20 py-8 text-center">
                <p className="text-sm text-muted-foreground">No content available</p>
              </div>
            )}
          </div>

          {/* content_url indicator */}
          {snippet.content_url && (
            <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
              <ExternalLink className="size-2.5" />
              Content loaded from remote URL
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
