import { useState } from "react";
import { Info, Loader2, Save } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { FileIcon } from "~/components/files/file-icon";
import { formatFileSize, formatDate, formatPermissions } from "~/lib/file-utils";
import { getRpcClient } from "~/lib/rpc-client";
import type { FileEntry } from "~/stores/file-store";

interface PropertiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: FileEntry | null;
  onUpdated: () => void;
}

export function PropertiesDialog({
  open,
  onOpenChange,
  entry,
  onUpdated,
}: PropertiesDialogProps) {
  const [permissions, setPermissions] = useState("");
  const [owner, setOwner] = useState("");
  const [group, setGroup] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = (isOpen: boolean) => {
    if (isOpen && entry) {
      setPermissions(entry.mode !== null ? (entry.mode & 0o777).toString(8) : "");
      setOwner(entry.uid?.toString() ?? "");
      setGroup(entry.gid?.toString() ?? "");
      setError(null);
    }
    onOpenChange(isOpen);
  };

  const handleSavePermissions = async () => {
    if (!entry) return;
    setIsSaving(true);
    setError(null);

    try {
      const rpc = getRpcClient();

      // Save chmod
      if (permissions) {
        const mode = parseInt(permissions, 8);
        if (isNaN(mode) || mode < 0 || mode > 0o777) {
          throw new Error("Invalid permission mode (use octal, e.g. 755)");
        }
        await rpc.call("fs.chmod", { path: entry.path, mode });
      }

      // Save chown
      const newUid = owner ? parseInt(owner, 10) : undefined;
      const newGid = group ? parseInt(group, 10) : undefined;
      if (newUid !== undefined || newGid !== undefined) {
        await rpc.call("fs.chown", {
          path: entry.path,
          uid: newUid ?? null,
          gid: newGid ?? null,
        });
      }

      onUpdated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setIsSaving(false);
    }
  };

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="size-5" />
            Properties
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File info header */}
          <div className="flex min-w-0 items-center gap-3">
            <FileIcon type={entry.type} name={entry.name} className="size-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={entry.name}>
                {entry.name}
              </p>
              <p className="truncate text-sm text-muted-foreground" title={entry.path}>
                {entry.path}
              </p>
            </div>
          </div>

          <Separator />

          {/* General info */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <span className="text-muted-foreground">Type</span>
            <span className="min-w-0 break-all capitalize">
              {entry.type}
              {entry.symlink_target ? ` → ${entry.symlink_target}` : ""}
            </span>

            <span className="text-muted-foreground">Size</span>
            <span className="min-w-0">
              {entry.type === "directory" ? "—" : formatFileSize(entry.size)}
            </span>

            <span className="text-muted-foreground">Modified</span>
            <span className="min-w-0">{formatDate(entry.modified)}</span>

            <span className="text-muted-foreground">Created</span>
            <span className="min-w-0">{formatDate(entry.created)}</span>

            <span className="text-muted-foreground">Read-only</span>
            <span className="min-w-0">{entry.readonly ? "Yes" : "No"}</span>

            {entry.mode !== null && (
              <>
                <span className="text-muted-foreground">Permissions</span>
                <span className="min-w-0 break-all font-mono text-xs">
                  {formatPermissions(entry.mode)} ({(entry.mode & 0o777).toString(8)})
                </span>
              </>
            )}

            {entry.owner !== null && (
              <>
                <span className="text-muted-foreground">Owner</span>
                <span className="min-w-0 break-all">
                  {entry.owner} (uid: {entry.uid})
                </span>
              </>
            )}

            {entry.group !== null && (
              <>
                <span className="text-muted-foreground">Group</span>
                <span className="min-w-0 break-all">
                  {entry.group} (gid: {entry.gid})
                </span>
              </>
            )}
          </div>

          {/* Permission editing (Unix only) */}
          {entry.mode !== null && (
            <>
              <Separator />
              <div className="space-y-3">
                <p className="text-sm font-medium">Edit Permissions</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="perm-mode" className="text-xs">
                      Mode (octal)
                    </Label>
                    <Input
                      id="perm-mode"
                      value={permissions}
                      onChange={(e) => setPermissions(e.target.value)}
                      placeholder="755"
                      className="h-8 font-mono text-sm"
                      maxLength={4}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="perm-uid" className="text-xs">
                      Owner (uid)
                    </Label>
                    <Input
                      id="perm-uid"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      placeholder="uid"
                      className="h-8 font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="perm-gid" className="text-xs">
                      Group (gid)
                    </Label>
                    <Input
                      id="perm-gid"
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                      placeholder="gid"
                      className="h-8 font-mono text-sm"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {entry.mode !== null && (
            <Button
              onClick={() => void handleSavePermissions()}
              disabled={isSaving}
            >
              {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
              <Save className="mr-2 size-4" />
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
