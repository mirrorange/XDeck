import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { getRpcClient } from "~/lib/rpc-client";

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paths: string[];
  onDeleted: () => void;
}

export function DeleteDialog({
  open,
  onOpenChange,
  paths,
  onDeleted,
}: DeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = paths.length;
  const names = paths.map((p) => p.split("/").pop()).filter(Boolean);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const rpc = getRpcClient();
      for (const path of paths) {
        await rpc.call("fs.delete", { path, recursive: true });
      }
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="size-5 text-destructive" />
            Delete {count === 1 ? "item" : `${count} items`}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {count === 1 ? (
                <p>
                  Are you sure you want to delete <strong>{names[0]}</strong>?
                  This action cannot be undone.
                </p>
              ) : (
                <>
                  <p>
                    Are you sure you want to delete these {count} items? This
                    action cannot be undone.
                  </p>
                  {count <= 10 && (
                    <ul className="mt-2 list-disc pl-4 text-sm">
                      {names.map((name, i) => (
                        <li key={i}>{name}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {error && (
                <p className="mt-2 text-sm text-destructive">{error}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleDelete();
            }}
            disabled={isDeleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {isDeleting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
