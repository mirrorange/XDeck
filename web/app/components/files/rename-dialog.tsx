import { useState } from "react";
import { Edit, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getRpcClient } from "~/lib/rpc-client";
import type { FileEntry } from "~/stores/file-store";

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: FileEntry | null;
  onRenamed: () => void;
}

export function RenameDialog({
  open,
  onOpenChange,
  entry,
  onRenamed,
}: RenameDialogProps) {
  const [name, setName] = useState(entry?.name ?? "");
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update name when entry changes
  const handleOpen = (isOpen: boolean) => {
    if (isOpen && entry) {
      setName(entry.name);
      setError(null);
    }
    onOpenChange(isOpen);
  };

  const handleRename = async () => {
    if (!entry) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === entry.name) return;

    setIsRenaming(true);
    setError(null);

    try {
      const rpc = getRpcClient();
      const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/"));
      const newPath = `${parentDir}/${trimmed}`;
      await rpc.call("fs.rename", { from: entry.path, to: newPath });
      onOpenChange(false);
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="size-5" />
            Rename
          </DialogTitle>
          <DialogDescription>
            Rename "{entry?.name}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="new-name">New name</Label>
          <Input
            id="new-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
            }}
            autoFocus
            onFocus={(e) => {
              // Select filename without extension
              const dotIdx = name.lastIndexOf(".");
              if (dotIdx > 0) {
                e.target.setSelectionRange(0, dotIdx);
              } else {
                e.target.select();
              }
            }}
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleRename()}
            disabled={!name.trim() || name.trim() === entry?.name || isRenaming}
          >
            {isRenaming && <Loader2 className="mr-2 size-4 animate-spin" />}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
