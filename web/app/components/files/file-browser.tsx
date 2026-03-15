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
import { TaskListPanel } from "~/components/files/task-list-panel";
import { Drawer, DrawerContent } from "~/components/ui/drawer";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useMediaQuery } from "~/hooks/use-mobile";
import { useFileStore, type FileEntry } from "~/stores/file-store";
import { downloadFile, downloadFolder, uploadFiles, uploadFolder } from "~/lib/file-transfer";
import { isPreviewable } from "~/lib/file-utils";
import { XDECK_MIME } from "~/lib/dnd-utils";
import { useLassoSelection, LassoOverlay } from "~/lib/lasso-selection";
import { getRpcClient } from "~/lib/rpc-client";
import { toast } from "sonner";

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
  const isCompactLayout = useMediaQuery("(max-width: 1023px)");

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
      setContextEntry(entry);
      setContextMenuContentKey((current) => current + 1);
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
      setContextMenuContentKey((current) => current + 1);
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
            // Check if the path is a directory by looking at entries
            const entry = activeTab.entries.find((e) => e.path === p);
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
                // RPC returns immediately with task_id; progress tracked via task events
                const archiveName = contextEntry.name;
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
    [activeTab, contextEntry, handleOpen, refresh, selectAll, getSelectedPaths]
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

  return (
    <div
      className="flex h-full flex-col relative"
      onDragEnter={handleDesktopDragEnter}
      onDragOver={handleDesktopDragOver}
      onDragLeave={handleDesktopDragLeave}
      onDrop={handleDesktopDrop}
    >
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
                      onOpen={handleOpen}
                      onContextMenu={handleContextMenu}
                      onDropFiles={handleDropFiles}
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
                      onOpen={handleOpen}
                      onContextMenu={handleContextMenu}
                      onDropFiles={handleDropFiles}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </ScrollArea>
        </FileContextMenu>

        <AnimatePresence>
          {searchOpen && !isCompactLayout && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden shrink-0"
            >
              <FileSearchPanel
                currentPath={activeTab.path}
                onNavigate={(path) => void navigateTo(activeTab.id, path)}
                onClose={() => setSearchOpen(false)}
                className="w-[350px] border-l"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {previewEntry && !isCompactLayout && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 400, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="shrink-0 overflow-hidden"
            >
              <FilePreview
                entry={previewEntry}
                onClose={() => setPreviewEntry(null)}
                className="border-l"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <TaskListPanel />
      </div>

      {isCompactLayout && (
        <>
          <Drawer open={searchOpen} onOpenChange={setSearchOpen}>
            <DrawerContent className="h-[75dvh] max-h-[75dvh]">
              <FileSearchPanel
                currentPath={activeTab.path}
                onNavigate={(path) => void navigateTo(activeTab.id, path)}
                onClose={() => setSearchOpen(false)}
              />
            </DrawerContent>
          </Drawer>

          <Drawer open={previewEntry !== null} onOpenChange={(open) => !open && setPreviewEntry(null)}>
            <DrawerContent className="h-[85dvh] max-h-[85dvh]">
              {previewEntry && (
                <FilePreview
                  entry={previewEntry}
                  onClose={() => setPreviewEntry(null)}
                />
              )}
            </DrawerContent>
          </Drawer>
        </>
      )}

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
