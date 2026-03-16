import { CheckSquare, Square, X } from "lucide-react";

import { Button } from "~/components/ui/button";

interface MobileSelectionHeaderProps {
  selectionCount: number;
  totalCount: number;
  onExitSelection: () => void;
  onSelectAll: () => void;
}

export function MobileSelectionHeader({
  selectionCount,
  totalCount,
  onExitSelection,
  onSelectAll,
}: MobileSelectionHeaderProps) {
  const allSelected = selectionCount > 0 && selectionCount === totalCount;

  return (
    <div className="flex h-12 items-center gap-2 border-b bg-primary/5 px-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={onExitSelection}
      >
        <X className="size-5" />
      </Button>

      <span className="flex-1 text-sm font-medium">
        {selectionCount} selected
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-3 text-sm"
        onClick={onSelectAll}
      >
        {allSelected ? (
          <Square className="size-4" />
        ) : (
          <CheckSquare className="size-4" />
        )}
        {allSelected ? "Deselect" : "All"}
      </Button>
    </div>
  );
}
