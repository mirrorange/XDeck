import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpCircle,
  Check,
  ChevronRight,
  Copy,
  Download,
  Edit,
  ExternalLink,
  Filter,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Store,
  Tag,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";

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
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "~/components/responsive-modal";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { useSnippetStore } from "~/stores/snippet-store";
import {
  useSnippetStoreStore,
  compareVersions,
  type RemoteSnippet,
} from "~/stores/snippet-store-store";

type FilterMode = "all" | "installed" | "not_installed";

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
    toggleSource,
    fetchRemoteSnippets,
    installSnippet,
    fetchSnippetContent,
  } = useSnippetStoreStore();

  const { snippets: installedSnippets, fetchSnippets, deleteSnippet } = useSnippetStore();

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("browse");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedSnippet, setSelectedSnippet] = useState<RemoteSnippet & { sourceName: string } | null>(null);
  const [editingSnippet, setEditingSnippet] = useState<RemoteSnippet & { sourceName: string } | null>(null);
  const [snippetToDelete, setSnippetToDelete] = useState<{ id: string; name: string } | null>(null);

  // Source form
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [isAddingSource, setIsAddingSource] = useState(false);

  // Build a map of store_snippet_id -> installed snippet info
  const installedMap = useMemo(() => {
    const map = new Map<string, { id: string; version?: string | null }>();
    for (const s of installedSnippets) {
      if (s.store_snippet_id) {
        map.set(s.store_snippet_id, { id: s.id, version: s.store_version });
      }
    }
    return map;
  }, [installedSnippets]);

  // Load data on open
  useEffect(() => {
    if (open) {
      void fetchSources();
      void fetchRemoteSnippets();
      void fetchSnippets();
    }
  }, [open, fetchSources, fetchRemoteSnippets, fetchSnippets]);

  // Reset selection when closing
  useEffect(() => {
    if (!open) {
      setSelectedSnippet(null);
      setEditingSnippet(null);
      setSearch("");
      setTab("browse");
      setFilterMode("all");
    }
  }, [open]);

  const allSnippets = results.flatMap((r) =>
    r.snippets.map((s) => ({ ...s, sourceName: r.source.name }))
  );

  const filtered = useMemo(() => {
    return allSnippets.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        const matchesSearch =
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)) ||
          s.author.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      if (filterMode === "installed") {
        return installedMap.has(s.id);
      }
      if (filterMode === "not_installed") {
        return !installedMap.has(s.id);
      }

      return true;
    });
  }, [allSnippets, search, filterMode, installedMap]);

  const handleInstall = useCallback(
    async (snippet: RemoteSnippet, customCommand?: string) => {
      try {
        const resolvedCommand = customCommand ?? await fetchSnippetContent(snippet);
        await installSnippet(snippet, resolvedCommand || undefined);
        await fetchSnippets();
        toast.success(`Installed "${snippet.name}"`);
      } catch (err) {
        toast.error(`Failed to install: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [installSnippet, fetchSnippets, fetchSnippetContent]
  );

  const handleUninstall = useCallback(
    (storeSnippetId: string, snippetName: string) => {
      const installed = installedMap.get(storeSnippetId);
      if (!installed) return;
      setSnippetToDelete({ id: installed.id, name: snippetName });
    },
    [installedMap]
  );

  const confirmUninstall = useCallback(
    async () => {
      if (!snippetToDelete) return;
      try {
        await deleteSnippet(snippetToDelete.id);
        await fetchSnippets();
        toast.success("Snippet removed");
      } catch (err) {
        toast.error(`Failed to remove: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setSnippetToDelete(null);
      }
    },
    [snippetToDelete, deleteSnippet, fetchSnippets]
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

  const handleToggleSource = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await toggleSource(id, enabled);
        if (enabled) {
          void fetchRemoteSnippets();
        }
      } catch (err) {
        toast.error(
          `Failed to toggle source: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    [toggleSource, fetchRemoteSnippets]
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
    setEditingSnippet(null);
  }, []);

  const getSnippetStatus = useCallback(
    (snippet: RemoteSnippet) => {
      const installed = installedMap.get(snippet.id);
      if (!installed) return "not_installed" as const;
      if (
        snippet.version &&
        installed.version &&
        compareVersions(snippet.version, installed.version) > 0
      ) {
        return "update_available" as const;
      }
      return "installed" as const;
    },
    [installedMap]
  );

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="w-full sm:max-w-2xl overflow-hidden">
        {editingSnippet ? (
          <EditAndInstallView
            snippet={editingSnippet}
            isInstalling={installingIds.has(editingSnippet.id)}
            onInstall={(command) => handleInstall(editingSnippet, command)}
            onBack={handleBack}
            fetchSnippetContent={fetchSnippetContent}
          />
        ) : selectedSnippet ? (
          /* ── Detail View ─────────────────────────────────────── */
          <SnippetDetailView
            snippet={selectedSnippet}
            status={getSnippetStatus(selectedSnippet)}
            isInstalling={installingIds.has(selectedSnippet.id)}
            onInstall={() => handleInstall(selectedSnippet)}
            onUninstall={() => handleUninstall(selectedSnippet.id, selectedSnippet.name)}
            onEditAndInstall={() => {
              setEditingSnippet(selectedSnippet);
              setSelectedSnippet(null);
            }}
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

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <TabsList className="w-full">
                <TabsTrigger value="browse" className="flex-1">
                  Browse
                </TabsTrigger>
                <TabsTrigger value="sources" className="flex-1">
                  Sources
                </TabsTrigger>
              </TabsList>

              {/* ── Browse Tab ─────────────────────────────────── */}
              <TabsContent value="browse" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
                  <FilterDropdown value={filterMode} onChange={setFilterMode} />
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

                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                  <div className="space-y-3 pb-2 pr-1">
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
                      <div className="space-y-2">
                        {filtered.map((snippet) => (
                          <SnippetStoreItem
                            key={`${snippet.sourceName}-${snippet.id}`}
                            snippet={snippet}
                            sourceName={snippet.sourceName}
                            status={getSnippetStatus(snippet)}
                            isInstalling={installingIds.has(snippet.id)}
                            onInstall={() => handleInstall(snippet)}
                            onUninstall={() => handleUninstall(snippet.id, snippet.name)}
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
                  </div>
                </div>
              </TabsContent>

              {/* ── Sources Tab ────────────────────────────────── */}
              <TabsContent value="sources" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                  <div className="space-y-2 pb-2 pr-1">
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
                      <>
                        {sources.map((source) => (
                          <div
                            key={source.id}
                            className="flex items-center justify-between gap-3 rounded-lg border p-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate text-sm font-medium">{source.name}</span>
                                {source.id === "official" && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                                    Official
                                  </Badge>
                                )}
                                {!source.enabled && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground shrink-0">
                                    Disabled
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-0.5 truncate pl-5.5 text-xs text-muted-foreground" title={source.url}>
                                {source.url}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Switch
                                checked={source.enabled}
                                onCheckedChange={(checked) => handleToggleSource(source.id, checked)}
                                aria-label={`Toggle ${source.name}`}
                              />
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
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </ResponsiveModalContent>

      <AlertDialog open={!!snippetToDelete} onOpenChange={(open) => { if (!open) setSnippetToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Snippet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{snippetToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmUninstall}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResponsiveModal>
  );
}

// ── Filter Dropdown ───────────────────────────────────────────────

function FilterDropdown({
  value,
  onChange,
}: {
  value: FilterMode;
  onChange: (v: FilterMode) => void;
}) {
  const [open, setOpen] = useState(false);

  const labels: Record<FilterMode, string> = {
    all: "All",
    installed: "Installed",
    not_installed: "Not Installed",
  };

  return (
    <div className="relative">
      <Button
        variant={value !== "all" ? "secondary" : "outline"}
        size="sm"
        className="h-8 text-xs gap-1"
        onClick={() => setOpen(!open)}
      >
        <Filter className="size-3" />
        {labels[value]}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border bg-popover p-1 shadow-md">
            {(Object.keys(labels) as FilterMode[]).map((mode) => (
              <button
                key={mode}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                onClick={() => {
                  onChange(mode);
                  setOpen(false);
                }}
              >
                {value === mode && <Check className="size-3" />}
                <span className={value !== mode ? "pl-5" : ""}>{labels[mode]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Snippet List Item ─────────────────────────────────────────────

type SnippetStatus = "not_installed" | "installed" | "update_available";

interface SnippetStoreItemProps {
  snippet: RemoteSnippet;
  sourceName: string;
  status: SnippetStatus;
  isInstalling: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onViewDetail: () => void;
}

function SnippetStoreItem({
  snippet,
  sourceName,
  status,
  isInstalling,
  onInstall,
  onUninstall,
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
              {status === "installed" && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 shrink-0 bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20">
                  Installed
                </Badge>
              )}
              {status === "update_available" && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 shrink-0 bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20">
                  Update
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
        {status === "installed" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onUninstall();
            }}
            className="h-7 shrink-0 text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 size-3" />
            Remove
          </Button>
        ) : status === "update_available" ? (
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
              <ArrowUpCircle className="mr-1 size-3" />
            )}
            Update
          </Button>
        ) : (
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
        )}
      </div>
    </div>
  );
}

// ── Snippet Detail View ───────────────────────────────────────────

interface SnippetDetailViewProps {
  snippet: RemoteSnippet & { sourceName: string };
  status: SnippetStatus;
  isInstalling: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onEditAndInstall: () => void;
  onBack: () => void;
  fetchSnippetContent: (snippet: RemoteSnippet) => Promise<string>;
}

function SnippetDetailView({
  snippet,
  status,
  isInstalling,
  onInstall,
  onUninstall,
  onEditAndInstall,
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
    if (content !== null) return;
    if (!snippet.content_url) {
      setContent("");
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
            {status === "installed" && (
              <Badge variant="secondary" className="text-[10px] px-1.5 bg-green-500/15 text-green-600 dark:text-green-400">
                Installed
              </Badge>
            )}
            {status === "update_available" && (
              <Badge variant="secondary" className="text-[10px] px-1.5 bg-blue-500/15 text-blue-600 dark:text-blue-400">
                Update Available
              </Badge>
            )}
          </div>
          {snippet.description && (
            <p className="mt-1 text-sm text-muted-foreground leading-snug">
              {snippet.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onEditAndInstall}
            disabled={isLoadingContent}
            className="h-8"
            title="Edit script before installing"
          >
            <Edit className="mr-1.5 size-3.5" />
            Edit
          </Button>

          {status === "installed" ? (
            <Button
              variant="outline"
              onClick={onUninstall}
              size="sm"
              className="shrink-0 h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Remove
            </Button>
          ) : status === "update_available" ? (
            <Button
              onClick={onInstall}
              disabled={isInstalling || isLoadingContent}
              size="sm"
              className="shrink-0 h-8"
            >
              {isInstalling ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  Updating…
                </>
              ) : (
                <>
                  <ArrowUpCircle className="mr-1.5 size-3.5" />
                  Update
                </>
              )}
            </Button>
          ) : (
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
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 pt-4 pr-1">
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
        </div>
      </div>
    </div>
  );
}

// ── Edit and Install View ─────────────────────────────────────────

interface EditAndInstallViewProps {
  snippet: RemoteSnippet & { sourceName: string };
  isInstalling: boolean;
  onInstall: (command: string) => void;
  onBack: () => void;
  fetchSnippetContent: (snippet: RemoteSnippet) => Promise<string>;
}

function EditAndInstallView({
  snippet,
  isInstalling,
  onInstall,
  onBack,
  fetchSnippetContent,
}: EditAndInstallViewProps) {
  const [content, setContent] = useState<string>("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  useEffect(() => {
    if (snippet.command) {
      setContent(snippet.command);
      return;
    }
    if (!snippet.content_url) {
      setContent("");
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

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-start gap-3 pb-4 border-b">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onBack}
          className="mt-0.5 shrink-0"
          title="Back"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold leading-tight">Edit & Install</h2>
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {snippet.name}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground leading-snug">
            Edit the script content before installing
          </p>
        </div>

        <Button
          onClick={() => onInstall(content)}
          disabled={isInstalling || isLoadingContent || !content.trim()}
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

      <div className="pt-4 flex-1 flex flex-col min-h-0">
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
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 font-mono text-xs min-h-[200px] max-h-[50vh] resize-none"
            placeholder="Enter script content…"
          />
        )}
      </div>
    </div>
  );
}
