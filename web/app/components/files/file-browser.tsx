import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { FileTabBar } from "~/components/files/file-tab-bar";
import { FileToolbar } from "~/components/files/file-toolbar";
import { FileListView } from "~/components/files/file-list-view";
import { FileGridView } from "~/components/files/file-grid-view";
import { FileContextMenu, type FileAction } from "~/components/files/file-context-menu";
import { FileStatusBar } from "~/components/files/file-status-bar";
import { NewFolderDialog } from "~/components/files/new-folder-dialog";
import { RenameDialog } from "~/components/files/rename-dialog";
import { DeleteDialog } from "~/components/files/delete-dialog";
import { PropertiesDialog } from "~/components/files/properties-dialog";
import { MoveDialog } from "~/components/files/move-dialog";
import { FileSearchPanel } from "~/components/files/file-search-panel";
import { UploadDialog } from "~/components/files/upload-dialog";
import { CompressDialog } from "~/components/files/compress-dialog";
import { FilePreview } from "~/components/files/file-preview";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useFileStore, type FileEntry } from "~/stores/file-store";
import { downloadFile } from "~/lib/file-transfer";
import { isPreviewable } from "~/lib/file-utils";
import { getRpcClient } from "~/lib/rpc-client";

export function FileBrowser() {
  const {
    tabs,
    activeTabId,
    viewMode,
    addTab,
    getHomeDir,
    navigateTo,
    refresh,
    selectAll,
    clearSelection,
    selectFile,
  } = useFileStore();

  const [contextEntry, setContextEntry] = useState<FileEntry | null>(null);

  // Dialog states
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePaths, setDeletePaths] = useState<string[]>([]);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [propertiesEntry, setPropertiesEntry] = useState<FileEntry | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveMode, setMoveMode] = useState<"copy" | "move">("move");
  const [movePaths, setMovePaths] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [compressPaths, setCompressPaths] = useState<string[]>([]);
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);

  // Initialize with home dir on first mount
  useEffect(() => {
    if (tabs.length === 0) {
      void (async () => {
        try {
          const home = await getHomeDir();
          addTab(home);
        } catch {
          addTab("/");
        }
      })();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (!activeTab) return;
      if (entry.type === "directory") {
        void navigateTo(activeTab.id, entry.path);
      } else if (isPreviewable(entry.type, entry.name)) {
        setPreviewEntry(entry);
      }
    },
    [activeTab, navigateTo]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault();
      setContextEntry(entry);
      if (activeTab && !activeTab.selectedPaths.has(entry.path)) {
        selectFile(activeTab.id, entry.path, false);
      }
    },
    [activeTab, selectFile]
  );

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-slot='table-row']")) return;
      if ((e.target as HTMLElement).closest("button")) return;
      setContextEntry(null);
    },
    []
  );

  const getSelectedPaths = useCallback((): string[] => {
    if (!activeTab) return [];
    const selected = [...activeTab.selectedPaths];
    if (selected.length === 0 && contextEntry) {
      return [contextEntry.path];
    }
    return selected;
  }, [activeTab, contextEntry]);

  const handleAction = useCallback(
    (action: FileAction) => {
      if (!activeTab) return;
      switch (action) {
        case "open":
          if (contextEntry) handleOpen(contextEntry);
          break;
        case "refresh":
          void refresh(activeTab.id);
          break;
        case "select-all":
          selectAll(activeTab.id);
          break;
        case "new-folder":
          setNewFolderOpen(true);
          break;
        case "rename":
          if (contextEntry) {
            setRenameEntry(contextEntry);
            setRenameOpen(true);
          }
          break;
        case "delete": {
          const paths = getSelectedPaths();
          if (paths.length > 0) {
            setDeletePaths(paths);
            setDeleteOpen(true);
          }
          break;
        }
        case "properties":
          if (contextEntry) {
            setPropertiesEntry(contextEntry);
            setPropertiesOpen(true);
          }
          break;
        case "copy": {
          const paths = getSelectedPaths();
          if (paths.length > 0) {
            setMovePaths(paths);
            setMoveMode("copy");
            setMoveOpen(true);
          }
          break;
        }
        case "move": {
          const paths = getSelectedPaths();
          if (paths.length > 0) {
            setMovePaths(paths);
            setMoveMode("move");
            setMoveOpen(true);
          }
          break;
        }
        case "download": {
          const paths = getSelectedPaths();
          for (const p of paths) {
            downloadFile(p);
          }
          break;
        }
        case "upload":
          setUploadOpen(true);
          break;
        case "compress": {
          const paths = getSelectedPaths();
          if (paths.length > 0) {
            setCompressPaths(paths);
            setCompressOpen(true);
          }
          break;
        }
        case "extract":
          if (contextEntry) {
            void (async () => {
              try {
                await getRpcClient().call("fs.extract", {
                  archive: contextEntry.path,
                  dest: activeTab.path,
                });
                void refresh(activeTab.id);
              } catch {
                // silently fail for now
              }
            })();
          }
          break;
      }
    },
    [activeTab, contextEntry, handleOpen, refresh, selectAll, getSelectedPaths]
  );

  const handleRefreshCurrent = useCallback(() => {
    if (activeTab) void refresh(activeTab.id);
  }, [activeTab, refresh]);

  const handleDropFiles = useCallback(
    (targetDir: string) => {
      if (!activeTab) return;
      const paths = [...activeTab.selectedPaths];
      if (paths.length === 0) return;
      // Don't move a folder into itself
      const filtered = paths.filter((p) => !targetDir.startsWith(p + "/") && p !== targetDir);
      if (filtered.length === 0) return;
      void (async () => {
        const rpc = getRpcClient();
        for (const src of filtered) {
          try {
            await rpc.call("fs.move", { source: src, dest: targetDir });
          } catch {
            // skip failed moves
          }
        }
        void refresh(activeTab.id);
      })();
    },
    [activeTab, refresh]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!activeTab) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        selectAll(activeTab.id);
      }

      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
        } else if (previewEntry) {
          setPreviewEntry(null);
        } else {
          clearSelection(activeTab.id);
        }
      }

      if (e.key === "Backspace" && !e.metaKey) {
        e.preventDefault();
        useFileStore.getState().goUp(activeTab.id);
      }

      if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.key === "r")) {
        e.preventDefault();
        void refresh(activeTab.id);
      }

      if (e.key === "Delete" || (e.metaKey && e.key === "Backspace")) {
        const paths = [...activeTab.selectedPaths];
        if (paths.length > 0) {
          e.preventDefault();
          setDeletePaths(paths);
          setDeleteOpen(true);
        }
      }

      if (e.key === "F2") {
        const selected = [...activeTab.selectedPaths];
        if (selected.length === 1) {
          const entry = activeTab.entries.find((en) => en.path === selected[0]);
          if (entry) {
            e.preventDefault();
            setRenameEntry(entry);
            setRenameOpen(true);
          }
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, selectAll, clearSelection, refresh, searchOpen]);

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <FileTabBar tabs={tabs} activeTabId={activeTabId} />

      <FileToolbar
        tabId={activeTab.id}
        path={activeTab.path}
        canGoBack={activeTab.historyIndex > 0}
        canGoForward={activeTab.historyIndex < activeTab.history.length - 1}
        onSearchToggle={() => setSearchOpen(!searchOpen)}
      />

      <div className="flex flex-1 min-h-0">
        <FileContextMenu
          entry={contextEntry}
          hasSelection={activeTab.selectedPaths.size > 0}
          selectionCount={activeTab.selectedPaths.size}
          onAction={handleAction}
        >
          <ScrollArea
            className="flex-1"
            onContextMenu={handleEmptyContextMenu}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (
                !target.closest("[data-slot='table-row']") &&
                !target.closest("button")
              ) {
                clearSelection(activeTab.id);
              }
            }}
          >
            {activeTab.isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : activeTab.error ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
                <p className="text-sm">Failed to load directory</p>
                <p className="text-xs text-destructive">{activeTab.error}</p>
              </div>
            ) : viewMode === "list" ? (
              <FileListView
                tabId={activeTab.id}
                entries={activeTab.entries}
                selectedPaths={activeTab.selectedPaths}
                sortField={activeTab.sortField}
                sortDirection={activeTab.sortDirection}
                onOpen={handleOpen}
                onContextMenu={handleContextMenu}
                onDropFiles={handleDropFiles}
              />
            ) : (
              <FileGridView
                tabId={activeTab.id}
                entries={activeTab.entries}
                selectedPaths={activeTab.selectedPaths}
                onOpen={handleOpen}
                onContextMenu={handleContextMenu}
                onDropFiles={handleDropFiles}
              />
            )}
          </ScrollArea>
        </FileContextMenu>

        {searchOpen && (
          <FileSearchPanel
            currentPath={activeTab.path}
            onNavigate={(path) => void navigateTo(activeTab.id, path)}
            onClose={() => setSearchOpen(false)}
          />
        )}

        {previewEntry && (
          <div className="w-[400px] shrink-0">
            <FilePreview
              entry={previewEntry}
              onClose={() => setPreviewEntry(null)}
            />
          </div>
        )}
      </div>

      <FileStatusBar tab={activeTab} />

      {/* Dialogs */}
      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        currentPath={activeTab.path}
        onCreated={handleRefreshCurrent}
      />

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        entry={renameEntry}
        onRenamed={handleRefreshCurrent}
      />

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        paths={deletePaths}
        onDeleted={handleRefreshCurrent}
      />

      <PropertiesDialog
        open={propertiesOpen}
        onOpenChange={setPropertiesOpen}
        entry={propertiesEntry}
        onUpdated={handleRefreshCurrent}
      />

      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        sourcePaths={movePaths}
        mode={moveMode}
        onCompleted={handleRefreshCurrent}
      />

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        currentPath={activeTab.path}
        onUploaded={handleRefreshCurrent}
      />

      <CompressDialog
        open={compressOpen}
        onOpenChange={setCompressOpen}
        paths={compressPaths}
        currentPath={activeTab.path}
        onCompleted={handleRefreshCurrent}
      />
    </div>
  );
}
