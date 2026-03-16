import type { FileTab } from "~/stores/file-store";

interface FileStatusBarProps {
  tab: FileTab;
}

export function FileStatusBar({ tab }: FileStatusBarProps) {
  const totalItems = tab.entries.length;
  const selectedCount = tab.selectedPaths.size;

  return (
    <div className="flex min-h-7 flex-col justify-center gap-1 border-t bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground sm:h-7 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:py-0">
      <span className="truncate">
        {totalItems} item{totalItems !== 1 ? "s" : ""}
        {selectedCount > 0 && (
          <> · {selectedCount} selected</>
        )}
      </span>
      <span className="max-w-full truncate font-mono">{tab.path}</span>
    </div>
  );
}
