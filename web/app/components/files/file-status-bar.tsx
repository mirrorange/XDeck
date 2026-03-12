import type { FileTab } from "~/stores/file-store";

interface FileStatusBarProps {
  tab: FileTab;
}

export function FileStatusBar({ tab }: FileStatusBarProps) {
  const totalItems = tab.entries.length;
  const selectedCount = tab.selectedPaths.size;

  return (
    <div className="flex h-7 items-center justify-between border-t bg-muted/30 px-3 text-xs text-muted-foreground">
      <span>
        {totalItems} item{totalItems !== 1 ? "s" : ""}
        {selectedCount > 0 && (
          <> · {selectedCount} selected</>
        )}
      </span>
      <span className="font-mono">{tab.path}</span>
    </div>
  );
}
