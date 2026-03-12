import { useCallback, useRef, useState } from "react";
import { Upload, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Progress } from "~/components/ui/progress";
import { uploadFiles, type UploadProgress, type UploadResult } from "~/lib/file-transfer";

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPath: string;
  onUploaded: () => void;
}

export function UploadDialog({ open, onOpenChange, currentPath, onUploaded }: UploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSelectedFiles([]);
    setUploading(false);
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!v) reset();
      onOpenChange(v);
    },
    [onOpenChange, reset]
  );

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
      setResult(null);
      setError(null);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const res = await uploadFiles(currentPath, selectedFiles, setProgress);
      setResult(res);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }, [selectedFiles, currentPath, onUploaded]);

  const progressPercent = progress ? Math.round((progress.loaded / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload to: <span className="font-mono text-foreground">{currentPath}</span>
          </p>

          {/* File input area */}
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Click to select files</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* Selected files list */}
          {selectedFiles.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {selectedFiles.map((file, i) => (
                <div key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm bg-muted/50">
                  <span className="truncate">{file.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                    {!uploading && (
                      <button onClick={() => removeFile(i)} className="hover:text-destructive">
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Progress bar */}
          {uploading && progress && (
            <div className="space-y-1">
              <Progress value={progressPercent} />
              <p className="text-xs text-muted-foreground text-center">
                {progressPercent}% - {progress.fileName}
              </p>
            </div>
          )}

          {/* Result */}
          {result && (
            <p className="text-sm text-green-600">
              Successfully uploaded {result.count} file{result.count !== 1 ? "s" : ""}.
            </p>
          )}

          {/* Error */}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={uploading}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={handleUpload} disabled={selectedFiles.length === 0 || uploading}>
              {uploading ? "Uploading..." : `Upload ${selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
