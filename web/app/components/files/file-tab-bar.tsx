import { useCallback, useRef, useState } from "react";
import { Folder, Plus, X } from "lucide-react";

import { useFileStore, type FileTab } from "~/stores/file-store";
import { XDECK_MIME } from "~/lib/dnd-utils";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { getRpcClient } from "~/lib/rpc-client";
import { truncateMiddleFilename } from "~/lib/file-utils";

/** Delay before switching tabs on drag hover (ms) */
const TAB_SWITCH_DELAY = 600;

interface FileTabBarProps {
  tabs: FileTab[];
  activeTabId: string | null;
}

export function FileTabBar({ tabs, activeTabId }: FileTabBarProps) {
  const { setActiveTab, closeTab, addTab, getHomeDir, refresh } = useFileStore();
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddTab = async () => {
    try {
      const home = await getHomeDir();
      addTab(home);
    } catch {
      addTab("/");
    }
  };

  const clearSwitchTimer = useCallback(() => {
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
  }, []);

  const handleTabDragOver = useCallback(
    (e: React.DragEvent, tab: FileTab) => {
      if (!e.dataTransfer.types.includes(XDECK_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (dragOverTabId !== tab.id) {
        setDragOverTabId(tab.id);
        clearSwitchTimer();

        // Auto-switch to the hovered tab after a delay
        if (tab.id !== activeTabId) {
          switchTimerRef.current = setTimeout(() => {
            setActiveTab(tab.id);
          }, TAB_SWITCH_DELAY);
        }
      }
    },
    [activeTabId, dragOverTabId, clearSwitchTimer, setActiveTab]
  );

  const handleTabDragLeave = useCallback(() => {
    setDragOverTabId(null);
    clearSwitchTimer();
  }, [clearSwitchTimer]);

  const handleTabDrop = useCallback(
    (e: React.DragEvent, tab: FileTab) => {
      e.preventDefault();
      setDragOverTabId(null);
      clearSwitchTimer();

      const data = e.dataTransfer.getData(XDECK_MIME);
      if (!data) return;

      const paths: string[] = JSON.parse(data);
      if (paths.length === 0) return;

      // Move files to the target tab's directory
      const targetDir = tab.path;
      void (async () => {
        const rpc = getRpcClient();
        for (const src of paths) {
          try {
            const fileName = src.split("/").pop() ?? "";
            if (!fileName) continue;
            // Don't move if it's already in the target
            if (src.startsWith(targetDir + "/") || src === targetDir) continue;
            const to = targetDir.endsWith("/")
              ? `${targetDir}${fileName}`
              : `${targetDir}/${fileName}`;
            await rpc.call("fs.move", { from: src, to });
          } catch {
            // skip failed moves
          }
        }
        // Refresh both the source and target tabs
        const sourceTabId = activeTabId;
        if (sourceTabId) void refresh(sourceTabId);
        void refresh(tab.id);
      })();
    },
    [activeTabId, clearSwitchTimer, refresh]
  );

  if (tabs.length <= 1) return null;

  return (
    <div className="flex h-9 items-center border-b bg-muted/30 min-w-0">
      <div className="flex h-full flex-1 items-center overflow-x-auto min-w-0 scrollbar-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDragOver = dragOverTabId === tab.id;
          return (
            <div
              key={tab.id}
              className={cn(
                "group relative flex h-full min-w-[100px] max-w-[180px] shrink-0 items-center gap-1.5 border-r px-3 text-sm transition-colors cursor-pointer select-none",
                isActive
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                isDragOver && !isActive && "bg-primary/10 border-primary/30"
              )}
              onClick={() => setActiveTab(tab.id)}
              onDragOver={(e) => handleTabDragOver(e, tab)}
              onDragLeave={handleTabDragLeave}
              onDrop={(e) => handleTabDrop(e, tab)}
            >
              <Folder className="size-3.5 shrink-0 text-amber-500" />
              <span className="truncate flex-1" title={tab.path}>
                {truncateMiddleFilename(tab.label, 24)}
              </span>
              <button
                className="shrink-0 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 mx-1 shrink-0"
        onClick={() => void handleAddTab()}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}
