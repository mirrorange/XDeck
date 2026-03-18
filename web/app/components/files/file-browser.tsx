import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

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
import { MobileSelectionBar } from "~/components/files/mobile-selection-bar";
import { MobileSelectionHeader } from "~/components/files/mobile-selection-header";
import { TaskListPanelContent } from "~/components/files/task-list-panel";
import { Drawer, DrawerContent } from "~/components/ui/drawer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useContextMenuGuard } from "~/hooks/use-context-menu-guard";
import { useMediaQuery, useIsMobile } from "~/hooks/use-mobile";
import { useFileStore, type FileEntry } from "~/stores/file-store";
import { useTaskStore } from "~/stores/task-store";
import { downloadFile, downloadFolder, uploadFiles, uploadFolder } from "~/lib/file-transfer";
import { isPreviewable } from "~/lib/file-utils";
import { XDECK_MIME } from "~/lib/dnd-utils";
import { useLassoSelection, LassoOverlay } from "~/lib/lasso-selection";
import { getRpcClient } from "~/lib/rpc-client";
import { toast } from "sonner";

type FileSidePanelState =
  | { kind: "closed" }
  | { kind: "search" }
  | { kind: "preview"; entry: FileEntry }
  | { kind: "tasks" };

interface FileActionContext {
  entry?: FileEntry | null;
  selectedEntries?: FileEntry[];
}

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
    setSelection,
  } = useFileStore();

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lassoContainerRef = useRef<HTMLElement | null>(null);
  const edgeScrollRafRef = useRef<number | null>(null);
  const lassoWasActiveRef = useRef(false);
  const initialTabRequestedRef = useRef(false);
  const isCompactLayout = useMediaQuery("(max-width: 1023px)");
  const isMobile = useIsMobile();
  const taskPanelRequestedOpen = useTaskStore((state) => state.panelOpen);
  const setTaskPanelOpen = useTaskStore((state) => state.setPanelOpen);
  const { rememberPointerType, shouldSuppressContextMenu } = useContextMenuGuard();

  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [sidePanel, setSidePanel] = useState<FileSidePanelState>(() =>
    taskPanelRequestedOpen ? { kind: "tasks" } : { kind: "closed" }
  );
  const [desktopPanelSize, setDesktopPanelSize] = useState(32);

  const [contextEntry, setContextEntry] = useState<FileEntry | null>(null);
  const [contextMenuContentKey, setContextMenuContentKey] = useState(0);

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
  const [uploadOpen, setUploadOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [compressPaths, setCompressPaths] = useState<string[]>([]);

  // Initialize with home dir on first mount
  useEffect(() => {
    if (tabs.length > 0 || initialTabRequestedRef.current) return;

    initialTabRequestedRef.current = true;
    void (async () => {
      try {
        const home = await getHomeDir();
        addTab(home);
      } catch {
        addTab("/");
      }
    })();
  }, [tabs.length, addTab, getHomeDir]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  // Resolve the scroll area viewport for lasso selection (layout effect to run before useEffect in lasso hook)
  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const viewport = el.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement | null;
    lassoContainerRef.current = viewport;
  });

  const handleLassoSelect = useCallback(
    (paths: Set<string>, additive: boolean) => {
      if (!activeTab) return;
      if (additive) {
        // Merge with existing selection
        const merged = new Set(activeTab.selectedPaths);
        for (const p of paths) merged.add(p);
        setSelection(activeTab.id, merged);
      } else {
        setSelection(activeTab.id, paths);
      }
    },
    [activeTab, setSelection]
  );

  const lassoState = useLassoSelection({
    containerRef: lassoContainerRef,
    itemSelector: "[data-lasso-item]",
    getPathFromElement: (el) => el.getAttribute("data-path"),
    onSelect: handleLassoSelect,
    enabled: !!activeTab && !activeTab.isLoading,
  });

  // Track when a lasso drag ends so the subsequent click doesn't clear selection
  useEffect(() => {
    if (lassoState.active) {
      lassoWasActiveRef.current = true;
    }
  }, [lassoState.active]);

  const setActiveSidePanel = useCallback(
    (nextPanel: FileSidePanelState) => {
      setSidePanel(nextPanel);
      setTaskPanelOpen(nextPanel.kind === "tasks");
    },
    [setTaskPanelOpen]
  );

  useEffect(() => {
    if (taskPanelRequestedOpen) {
      setSidePanel((current) =>
        current.kind === "tasks" ? current : { kind: "tasks" }
      );
      return;
    }

    setSidePanel((current) =>
      current.kind === "tasks" ? { kind: "closed" } : current
    );
  }, [taskPanelRequestedOpen]);

  const closeSearchPanel = useCallback(() => {
    setActiveSidePanel({ kind: "closed" });
  }, [setActiveSidePanel]);

  const closePreviewPanel = useCallback(() => {
    setActiveSidePanel({ kind: "closed" });
  }, [setActiveSidePanel]);

  const closeTaskPanel = useCallback(() => {
    setActiveSidePanel({ kind: "closed" });
  }, [setActiveSidePanel]);

  const toggleSearchPanel = useCallback(() => {
    setActiveSidePanel(
      sidePanel.kind === "search" ? { kind: "closed" } : { kind: "search" }
    );
  }, [sidePanel.kind, setActiveSidePanel]);

  const openPreviewPanel = useCallback(
    (entry: FileEntry) => {
      setActiveSidePanel({ kind: "preview", entry });
    },
    [setActiveSidePanel]
  );

  const toggleTaskPanel = useCallback(() => {
    setActiveSidePanel(
      sidePanel.kind === "tasks" ? { kind: "closed" } : { kind: "tasks" }
    );
  }, [sidePanel.kind, setActiveSidePanel]);

  const handleSidePanelOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setActiveSidePanel({ kind: "closed" });
      }
    },
    [setActiveSidePanel]
  );

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (!activeTab) return;
      if (entry.type === "directory") {
        // Exit multi-select mode when navigating to a new directory
        if (multiSelectMode) setMultiSelectMode(false);
        void navigateTo(activeTab.id, entry.path);
      } else if (isPreviewable(entry.type, entry.name)) {
        openPreviewPanel(entry);
      }
    },
    [activeTab, navigateTo, multiSelectMode, openPreviewPanel]
  );

  const handleLongPress = useCallback(
    (entry: FileEntry) => {
      if (!activeTab || !isMobile) return;
      setMultiSelectMode(true);
      selectFile(activeTab.id, entry.path, false);
    },
    [activeTab, isMobile, selectFile]
  );

  const handleToggleSelect = useCallback(
    (entry: FileEntry) => {
      if (!activeTab) return;
      selectFile(activeTab.id, entry.path, true);
    },
    [activeTab, selectFile]
  );

  const handleDragSelect = useCallback(
    (paths: Set<string>) => {
      if (!activeTab) return;
      setSelection(activeTab.id, paths);
    },
    [activeTab, setSelection]
  );

  const handleExitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    if (activeTab) clearSelection(activeTab.id);
  }, [activeTab, clearSelection]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      if (shouldSuppressContextMenu()) {
        e.preventDefault();
        return;
      }

      setContextEntry(entry);
      setContextMenuContentKey((current) => current + 1);
      if (activeTab && !activeTab.selectedPaths.has(entry.path)) {
        selectFile(activeTab.id, entry.path, false);
      }
    },
    [activeTab, selectFile, shouldSuppressContextMenu]
  );

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (shouldSuppressContextMenu()) {
        e.preventDefault();
        return;
      }

      if ((e.target as HTMLElement).closest("[data-slot='table-row']")) return;
      if ((e.target as HTMLElement).closest("button")) return;
      setContextEntry(null);
      setContextMenuContentKey((current) => current + 1);
    },
    [shouldSuppressContextMenu]
  );

  const getSelectedPaths = useCallback((): string[] => {
    if (!activeTab) return [];
    const selected = [...activeTab.selectedPaths];
    if (selected.length === 0 && contextEntry) {
      return [contextEntry.path];
    }
    return selected;
  }, [activeTab, contextEntry]);

  const resolveActionContext = useCallback(
    (override?: FileActionContext) => {
      const selectedEntries = override?.selectedEntries ?? (
        activeTab
          ? activeTab.entries.filter((entry) => activeTab.selectedPaths.has(entry.path))
          : []
      );
      const selectedPaths =
        override?.selectedEntries !== undefined
          ? override.selectedEntries.map((entry) => entry.path)
          : getSelectedPaths();
      const targetEntry =
        override?.entry ??
        contextEntry ??
        selectedEntries[0] ??
        null;

      return {
        selectedEntries,
        selectedPaths:
          selectedPaths.length > 0 || !targetEntry
            ? selectedPaths
            : [targetEntry.path],
        targetEntry,
      };
    },
    [activeTab, contextEntry, getSelectedPaths]
  );

  const handleAction = useCallback(
    (action: FileAction, override?: FileActionContext) => {
      if (!activeTab) return;
      const { selectedEntries, selectedPaths, targetEntry } = resolveActionContext(override);
      const selectedEntryMap = new Map(selectedEntries.map((entry) => [entry.path, entry]));
      switch (action) {
        case "open":
          if (targetEntry) handleOpen(targetEntry);
          break;
        case "open-in-new-tab":
          if (targetEntry?.type === "directory") {
            addTab(targetEntry.path);
          }
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
          if (targetEntry) {
            setRenameEntry(targetEntry);
            setRenameOpen(true);
          }
          break;
        case "delete": {
          if (selectedPaths.length > 0) {
            setDeletePaths(selectedPaths);
            setDeleteOpen(true);
          }
          break;
        }
        case "properties":
          if (targetEntry) {
            setPropertiesEntry(targetEntry);
            setPropertiesOpen(true);
          }
          break;
        case "copy": {
          if (selectedPaths.length > 0) {
            setMovePaths(selectedPaths);
            setMoveMode("copy");
            setMoveOpen(true);
          }
          break;
        }
        case "move": {
          if (selectedPaths.length > 0) {
            setMovePaths(selectedPaths);
            setMoveMode("move");
            setMoveOpen(true);
          }
          break;
        }
        case "download": {
          for (const p of selectedPaths) {
            const entry =
              selectedEntryMap.get(p) ??
              activeTab.entries.find((candidate) => candidate.path === p);
            if (entry?.type === "directory") {
              void downloadFolder(p).catch((err) => {
                toast.error("Download failed", {
                  description: err instanceof Error ? err.message : "Unknown error",
                });
              });
            } else {
              downloadFile(p);
            }
          }
          break;
        }
        case "upload":
          setUploadOpen(true);
          break;
        case "compress": {
          if (selectedPaths.length > 0) {
            setCompressPaths(selectedPaths);
            setCompressOpen(true);
          }
          break;
        }
        case "extract":
          if (targetEntry) {
            void (async () => {
              try {
                await getRpcClient().call("fs.extract", {
                  archive: targetEntry.path,
                  dest: activeTab.path,
                });
                // RPC returns immediately with task_id; progress tracked via task events
                const archiveName = targetEntry.name;
                toast.info("Extraction started", {
                  description: archiveName,
                });
              } catch (err) {
                toast.error("Extraction failed", {
                  description:
                    err instanceof Error ? err.message : "Unknown error",
                });
              }
            })();
          }
          break;
      }
    },
    [activeTab, addTab, handleOpen, refresh, resolveActionContext, selectAll]
  );

  const handleRefreshCurrent = useCallback(() => {
    if (activeTab) void refresh(activeTab.id);
  }, [activeTab, refresh]);

  const handleDropFiles = useCallback(
    (targetDir: string, sourcePaths: string[]) => {
      if (!activeTab) return;
      if (sourcePaths.length === 0) return;
      // Don't move a folder into itself
      const filtered = sourcePaths.filter((p) => !targetDir.startsWith(p + "/") && p !== targetDir);
      if (filtered.length === 0) return;
      void (async () => {
        const rpc = getRpcClient();
        for (const src of filtered) {
          try {
            const fileName = src.split("/").pop() ?? "";
            if (!fileName) continue;
            const to = targetDir.endsWith("/")
              ? `${targetDir}${fileName}`
              : `${targetDir}/${fileName}`;
            await rpc.call("fs.move", { from: src, to });
          } catch {
            // skip failed moves
          }
        }
        // Refresh all tabs — source files could be from any tab (cross-tab DnD)
        const allTabs = useFileStore.getState().tabs;
        for (const tab of allTabs) {
          void refresh(tab.id);
        }
      })();
    },
    [activeTab, refresh]
  );

  const activeSidePanelKind =
    sidePanel.kind === "closed" ? null : sidePanel.kind;
  const taskPanelOpen = activeSidePanelKind === "tasks";
  const searchPanelOpen = activeSidePanelKind === "search";
  const sidePanelOpen = activeSidePanelKind !== null;

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
        if (multiSelectMode) {
          handleExitMultiSelect();
        } else if (sidePanelOpen) {
          closeTaskPanel();
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
        setActiveSidePanel({ kind: "search" });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeTab,
    selectAll,
    clearSelection,
    refresh,
    multiSelectMode,
    handleExitMultiSelect,
    sidePanelOpen,
    closeTaskPanel,
    setActiveSidePanel,
  ]);

  // Edge scroll: auto-scroll when dragging near top/bottom of scroll area
  const EDGE_ZONE = 40;
  const EDGE_SPEED = 8;

  const handleScrollAreaDragOver = useCallback((e: React.DragEvent) => {
    // Allow drops on the scroll area background for internal DnD
    if (e.dataTransfer.types.includes(XDECK_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }

    const el = scrollAreaRef.current;
    if (!el) return;
    const viewport = el.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement | null;
    if (!viewport) return;

    const rect = el.getBoundingClientRect();
    const y = e.clientY;

    const stopEdgeScroll = () => {
      if (edgeScrollRafRef.current != null) {
        cancelAnimationFrame(edgeScrollRafRef.current);
        edgeScrollRafRef.current = null;
      }
    };

    if (y - rect.top < EDGE_ZONE) {
      if (edgeScrollRafRef.current == null) {
        const scroll = () => {
          viewport.scrollTop -= EDGE_SPEED;
          edgeScrollRafRef.current = requestAnimationFrame(scroll);
        };
        edgeScrollRafRef.current = requestAnimationFrame(scroll);
      }
    } else if (rect.bottom - y < EDGE_ZONE) {
      if (edgeScrollRafRef.current == null) {
        const scroll = () => {
          viewport.scrollTop += EDGE_SPEED;
          edgeScrollRafRef.current = requestAnimationFrame(scroll);
        };
        edgeScrollRafRef.current = requestAnimationFrame(scroll);
      }
    } else {
      stopEdgeScroll();
    }
  }, []);

  const handleScrollAreaDragLeave = useCallback(() => {
    if (edgeScrollRafRef.current != null) {
      cancelAnimationFrame(edgeScrollRafRef.current);
      edgeScrollRafRef.current = null;
    }
  }, []);

  // Drop handler on scroll area background: drops files into the current directory
  const handleScrollAreaDrop = useCallback(
    (e: React.DragEvent) => {
      if (!activeTab) return;
      // Only handle internal DnD drops (not desktop file drops)
      if (!e.dataTransfer.types.includes(XDECK_MIME)) return;
      // Directory entry drops call e.stopPropagation(), so this only fires
      // for drops on non-directory items or the empty background.

      e.preventDefault();
      // Stop edge scrolling
      if (edgeScrollRafRef.current != null) {
        cancelAnimationFrame(edgeScrollRafRef.current);
        edgeScrollRafRef.current = null;
      }

      const data = e.dataTransfer.getData(XDECK_MIME);
      if (!data) return;
      try {
        const paths: string[] = JSON.parse(data);
        if (paths.length > 0) {
          handleDropFiles(activeTab.path, paths);
        }
      } catch {
        // invalid data
      }
    },
    [activeTab, handleDropFiles]
  );

  // Desktop drag-to-upload: detect external file drops
  const [desktopDragOver, setDesktopDragOver] = useState(false);
  const desktopDragCounter = useRef(0);

  const isExternalDrag = useCallback((e: React.DragEvent): boolean => {
    return (
      e.dataTransfer.types.includes("Files") &&
      !e.dataTransfer.types.includes(XDECK_MIME)
    );
  }, []);

  const handleDesktopDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!isExternalDrag(e)) return;
      e.preventDefault();
      desktopDragCounter.current++;
      if (desktopDragCounter.current === 1) {
        setDesktopDragOver(true);
      }
    },
    [isExternalDrag]
  );

  const handleDesktopDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isExternalDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [isExternalDrag]
  );

  const handleDesktopDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!isExternalDrag(e)) return;
      desktopDragCounter.current--;
      if (desktopDragCounter.current <= 0) {
        desktopDragCounter.current = 0;
        setDesktopDragOver(false);
      }
    },
    [isExternalDrag]
  );

  const handleDesktopDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isExternalDrag(e) || !activeTab) return;
      e.preventDefault();
      desktopDragCounter.current = 0;
      setDesktopDragOver(false);

      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      // Check if any file has webkitRelativePath (folder upload via drag)
      const fileArray = Array.from(files);
      const hasFolderStructure = fileArray.some(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath
      );

      const uploadFn = hasFolderStructure ? uploadFolder : uploadFiles;
      void uploadFn(activeTab.path, fileArray).catch(() => {
        // Failure state is surfaced through the task list and resumed queue.
      });
    },
    [activeTab, isExternalDrag]
  );

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const sidePanelContent = (() => {
    switch (sidePanel.kind) {
      case "search":
        return (
          <FileSearchPanel
            currentPath={activeTab.path}
            onNavigate={(path) => void navigateTo(activeTab.id, path)}
            onAction={(action, payload) => handleAction(action, payload)}
            onClose={closeSearchPanel}
            className="h-full"
          />
        );
      case "preview":
        return (
          <FilePreview
            entry={sidePanel.entry}
            onClose={closePreviewPanel}
            className="h-full"
          />
        );
      case "tasks":
        return <TaskListPanelContent onClose={closeTaskPanel} className="h-full" />;
      case "closed":
        return null;
    }
  })();

  const drawerHeightClass =
    sidePanel.kind === "preview"
      ? "h-[85dvh] max-h-[85dvh]"
      : "h-[75dvh] max-h-[75dvh]";

  const browserContent = (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <FileContextMenu
        contentKey={contextMenuContentKey}
        entry={contextEntry}
        hasSelection={activeTab.selectedPaths.size > 0}
        selectionCount={activeTab.selectedPaths.size}
        onAction={handleAction}
      >
        <ScrollArea
          ref={scrollAreaRef}
          className="flex-1"
          onContextMenu={handleEmptyContextMenu}
          onDragOver={handleScrollAreaDragOver}
          onDragLeave={handleScrollAreaDragLeave}
          onDrop={handleScrollAreaDrop}
          onClick={(e) => {
            // Don't clear selection if a lasso drag just finished
            if (lassoWasActiveRef.current) {
              lassoWasActiveRef.current = false;
              return;
            }
            // Don't clear selection in multi-select mode (use the X button to exit)
            if (multiSelectMode) return;
            const target = e.target as HTMLElement;
            if (
              !target.closest("[data-slot='table-row']") &&
              !target.closest("button") &&
              !target.closest("[data-lasso-item]")
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
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {viewMode === "list" ? (
                <motion.div
                  key="list-view"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <FileListView
                    tabId={activeTab.id}
                    entries={activeTab.entries}
                    selectedPaths={activeTab.selectedPaths}
                    sortField={activeTab.sortField}
                    sortDirection={activeTab.sortDirection}
                    isMobile={isMobile}
                    multiSelectMode={multiSelectMode}
                    onOpen={handleOpen}
                    onContextMenu={handleContextMenu}
                    onDropFiles={handleDropFiles}
                    onLongPress={handleLongPress}
                    onToggleSelect={handleToggleSelect}
                    onDragSelect={handleDragSelect}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="grid-view"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <FileGridView
                    tabId={activeTab.id}
                    entries={activeTab.entries}
                    selectedPaths={activeTab.selectedPaths}
                    isMobile={isMobile}
                    multiSelectMode={multiSelectMode}
                    onOpen={handleOpen}
                    onContextMenu={handleContextMenu}
                    onDropFiles={handleDropFiles}
                    onLongPress={handleLongPress}
                    onToggleSelect={handleToggleSelect}
                    onDragSelect={handleDragSelect}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </ScrollArea>
      </FileContextMenu>
    </div>
  );

  return (
    <div
      className="flex h-full flex-col relative"
      onPointerDownCapture={(e) => rememberPointerType(e.pointerType)}
      onTouchStartCapture={() => rememberPointerType("touch")}
      onContextMenuCapture={(e) => {
        if (shouldSuppressContextMenu()) {
          e.preventDefault();
        }
      }}
      onDragEnter={handleDesktopDragEnter}
      onDragOver={handleDesktopDragOver}
      onDragLeave={handleDesktopDragLeave}
      onDrop={handleDesktopDrop}
    >
      <FileTabBar tabs={tabs} activeTabId={activeTabId} />

      {isMobile && multiSelectMode ? (
        <MobileSelectionHeader
          selectionCount={activeTab.selectedPaths.size}
          totalCount={activeTab.entries.length}
          onExitSelection={handleExitMultiSelect}
          onSelectAll={() => {
            if (activeTab.selectedPaths.size === activeTab.entries.length) {
              clearSelection(activeTab.id);
            } else {
              selectAll(activeTab.id);
            }
          }}
        />
      ) : (
        <FileToolbar
          tabId={activeTab.id}
          path={activeTab.path}
          canGoBack={activeTab.historyIndex > 0}
          canGoForward={activeTab.historyIndex < activeTab.history.length - 1}
          selectionCount={activeTab.selectedPaths.size}
          searchPanelOpen={searchPanelOpen}
          onSearchToggle={toggleSearchPanel}
          taskPanelOpen={taskPanelOpen}
          onTaskPanelToggle={toggleTaskPanel}
          onAction={handleAction}
        />
      )}

      <div className="flex flex-1 min-h-0">
        {sidePanelOpen && !isCompactLayout ? (
          <ResizablePanelGroup
            orientation="horizontal"
            className="flex-1 min-h-0"
          >
            <ResizablePanel
              defaultSize={`${Math.max(40, 100 - desktopPanelSize)}%`}
              minSize="40%"
            >
              {browserContent}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize={`${desktopPanelSize}%`}
              minSize="320px"
              maxSize="60%"
              onResize={(size) => setDesktopPanelSize(size.asPercentage)}
              className="min-w-[280px]"
            >
              <div className="h-full min-w-0 overflow-hidden bg-background">
                {sidePanelContent}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          browserContent
        )}
      </div>

      {isCompactLayout && (
        <Drawer open={sidePanelOpen} onOpenChange={handleSidePanelOpenChange}>
          <DrawerContent className={drawerHeightClass}>
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
              {sidePanelContent}
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {!isMobile && <FileStatusBar tab={activeTab} />}

      {/* Mobile multi-select bottom action bar */}
      {isMobile && multiSelectMode && (
        <MobileSelectionBar
          selectionCount={activeTab.selectedPaths.size}
          onAction={handleAction}
        />
      )}

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

      {/* Lasso selection overlay */}
      <LassoOverlay rect={lassoState.rect} />

      {/* Desktop drag-to-upload overlay */}
      <AnimatePresence>
        {desktopDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg pointer-events-none"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-2 text-primary"
            >
              <Upload className="size-12" />
              <p className="text-lg font-medium">Drop files to upload</p>
              <p className="text-sm text-muted-foreground">
                Files will be uploaded to {activeTab.path}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
