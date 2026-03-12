import { Folder, Plus, X } from "lucide-react";

import { useFileStore, type FileTab } from "~/stores/file-store";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface FileTabBarProps {
  tabs: FileTab[];
  activeTabId: string | null;
}

export function FileTabBar({ tabs, activeTabId }: FileTabBarProps) {
  const { setActiveTab, closeTab, addTab, getHomeDir } = useFileStore();

  const handleAddTab = async () => {
    try {
      const home = await getHomeDir();
      addTab(home);
    } catch {
      addTab("/");
    }
  };

  if (tabs.length <= 1) return null;

  return (
    <div className="flex h-9 items-center border-b bg-muted/30 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={cn(
              "group relative flex h-full min-w-[120px] max-w-[200px] items-center gap-1.5 border-r px-3 text-sm transition-colors cursor-pointer select-none",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            <Folder className="size-3.5 shrink-0 text-amber-500" />
            <span className="truncate flex-1" title={tab.path}>
              {tab.label}
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
