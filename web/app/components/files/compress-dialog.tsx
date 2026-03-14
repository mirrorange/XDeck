import { useCallback, useState } from "react";
import { Archive } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { getRpcClient } from "~/lib/rpc-client";
import { toast } from "sonner";

interface CompressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paths: string[];
  currentPath: string;
  onCompleted: () => void;
}

export function CompressDialog({
  open,
  onOpenChange,
  paths,
  currentPath,
  onCompleted,
}: CompressDialogProps) {
  const [format, setFormat] = useState<"zip" | "tar_gz">("zip");
  const [outputName, setOutputName] = useState("archive");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extension = format === "zip" ? ".zip" : ".tar.gz";

  const handleCompress = useCallback(async () => {
    const output = `${currentPath}/${outputName}${extension}`;
    setLoading(true);
    setError(null);
    try {
      await getRpcClient().call("fs.compress", {
        paths,
        output,
        format,
      });
      // RPC returns immediately with task_id; progress tracked via task events
      toast.info("Compression started", {
        description: `${outputName}${extension}`,
      });
      onOpenChange(false);
      onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compression failed");
    } finally {
      setLoading(false);
    }
  }, [paths, currentPath, outputName, extension, format, onOpenChange, onCompleted]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="size-4" />
            Compress {paths.length} item{paths.length !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Archive name</Label>
            <div className="flex gap-2">
              <Input
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder="archive"
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleCompress()}
              />
              <span className="flex items-center text-sm text-muted-foreground font-mono">
                {extension}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as "zip" | "tar_gz")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zip">ZIP (.zip)</SelectItem>
                <SelectItem value="tar_gz">TAR.GZ (.tar.gz)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-sm text-muted-foreground">
            <p>Files to compress:</p>
            <ul className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
              {paths.map((p) => (
                <li key={p} className="truncate font-mono text-xs">
                  {p.split("/").pop()}
                </li>
              ))}
            </ul>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCompress} disabled={!outputName.trim() || loading}>
            {loading ? "Compressing..." : "Compress"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
