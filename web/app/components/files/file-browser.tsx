import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { FileTabBar } from "~/components/files/file-tab-bar";
import { FileToolbar } from "~/components/files/file-toolbar";
import { FileListView } from "~/components/files/file-list-view";
import { FileGridView } from "~/components/files/file-grid-view";
import { FileContextMenu, type FileAction } from "~/components/files/file-context-menu";
import { FileStatusBar } from "~/components/files/file-status-bar";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useFileStore, type FileEntry } from "~/stores/file-store";

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
      }
      // File preview will be added in Stage 7
    },
    [activeTab, navigateTo]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault();
      setContextEntry(entry);
      // If the entry isn't already selected, select it
      if (activeTab && !activeTab.selectedPaths.has(entry.path)) {
        selectFile(activeTab.id, entry.path, false);
      }
    },
    [activeTab, selectFile]
  );

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Only trigger if clicking on empty space (not on a file)
      if ((e.target as HTMLElement).closest("[data-slot='table-row']")) return;
      if ((e.target as HTMLElement).closest("button")) return;
      setContextEntry(null);
    },
    []
  );

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
        case "rename":
        case "copy":
        case "move":
        case "delete":
        case "download":
        case "upload":
        case "compress":
        case "extract":
        case "properties":
          // These actions will be implemented in later stages
          break;
      }
    },
    [activeTab, contextEntry, handleOpen, refresh, selectAll]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!activeTab) return;
      // Ignore if focus is in an input
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        selectAll(activeTab.id);
      }

      if (e.key === "Escape") {
        clearSelection(activeTab.id);
      }

      if (e.key === "Backspace" && !e.metaKey) {
        e.preventDefault();
        useFileStore.getState().goUp(activeTab.id);
      }

      if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.key === "r")) {
        e.preventDefault();
        void refresh(activeTab.id);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, selectAll, clearSelection, refresh]);

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
      />

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
            // Click on empty space clears selection
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
            />
          ) : (
            <FileGridView
              tabId={activeTab.id}
              entries={activeTab.entries}
              selectedPaths={activeTab.selectedPaths}
              onOpen={handleOpen}
              onContextMenu={handleContextMenu}
            />
          )}
        </ScrollArea>
      </FileContextMenu>

      <FileStatusBar tab={activeTab} />
    </div>
  );
}
