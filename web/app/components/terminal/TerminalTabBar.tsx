import { Plus, Terminal, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { TerminalTab } from "~/stores/terminal-store";

interface TerminalTabBarProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  isCreating?: boolean;
  extraActions?: ReactNode;
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  isCreating,
  extraActions,
}: TerminalTabBarProps) {
  return (
    <div className="flex h-10 items-center gap-0 border-b bg-background/80 px-1">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "group flex h-8 max-w-[200px] min-w-[100px] cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
              tab.id === activeTabId
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
            onClick={() => onSelectTab(tab.id)}
          >
            <Terminal className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">{tab.title}</span>
            <button
              className={cn(
                "ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm transition-opacity",
                tab.id === activeTabId
                  ? "opacity-60 hover:opacity-100"
                  : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="ml-1 size-7 shrink-0"
        onClick={onNewTab}
        disabled={isCreating}
      >
        <Plus className="size-3.5" />
      </Button>

      {extraActions && (
        <div className="ml-0.5 flex items-center gap-0.5 border-l pl-1.5">
          {extraActions}
        </div>
      )}
    </div>
  );
}
