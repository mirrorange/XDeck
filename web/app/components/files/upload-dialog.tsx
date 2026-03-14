import { useCallback, useRef, useState } from "react";
import { FolderUp, Upload, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  uploadFiles,
  uploadFolder,
} from "~/lib/file-transfer";

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPath: string;
  onUploaded: () => void;
}

export function UploadDialog({ open, onOpenChange, currentPath, onUploaded }: UploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isFolderUpload, setIsFolderUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSelectedFiles([]);
    setIsFolderUpload(false);
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
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
      setIsFolderUpload(false);
      setError(null);
    }
  }, []);

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
      setIsFolderUpload(true);
      setError(null);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(() => {
    if (selectedFiles.length === 0) return;

    // Close the dialog immediately — progress is tracked in the task list panel
    onOpenChange(false);

    const uploadFn = isFolderUpload ? uploadFolder : uploadFiles;
    void uploadFn(currentPath, selectedFiles)
      .then(() => {
        onUploaded();
      })
      .catch(() => {
        // Error is handled by the task store
      });

    reset();
  }, [selectedFiles, isFolderUpload, currentPath, onUploaded, onOpenChange, reset]);

  /** Derive the folder name from the first file's relative path */
  const folderName = isFolderUpload && selectedFiles.length > 0
    ? (selectedFiles[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] ?? "folder"
    : null;

  /** Display name for file list: show relative path for folders, name for files */
  const getDisplayName = (file: File): string => {
    if (isFolderUpload) {
      return (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
    }
    return file.name;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload {isFolderUpload ? "Folder" : "Files"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload to: <span className="font-mono text-foreground">{currentPath}</span>
          </p>

          {/* File/Folder input area */}
          {selectedFiles.length === 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <div
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">Select Files</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
              <div
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderUp className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">Select Folder</p>
                <input
                  ref={folderInputRef}
                  type="file"
                  /* @ts-expect-error webkitdirectory is not in the type definitions */
                  webkitdirectory=""
                  className="hidden"
                  onChange={handleFolderSelect}
                />
              </div>
            </div>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => {
                if (isFolderUpload) {
                  folderInputRef.current?.click();
                } else {
                  fileInputRef.current?.click();
                }
              }}
            >
              {isFolderUpload ? (
                <FolderUp className="size-6 text-muted-foreground" />
              ) : (
                <Upload className="size-6 text-muted-foreground" />
              )}
              <p className="text-xs text-muted-foreground">Click to change selection</p>
              {/* Hidden inputs (need to stay in DOM) */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <input
                ref={folderInputRef}
                type="file"
                /* @ts-expect-error webkitdirectory is not in the type definitions */
                webkitdirectory=""
                className="hidden"
                onChange={handleFolderSelect}
              />
            </div>
          )}

          {/* Selected files summary */}
          {selectedFiles.length > 0 && (
            <>
              {isFolderUpload && folderName && (
                <p className="text-sm font-medium">
                  Folder: <span className="font-mono">{folderName}</span>
                  <span className="text-muted-foreground ml-1">
                    ({selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""})
                  </span>
                </p>
              )}
              <div className="max-h-40 overflow-y-auto space-y-1">
                {selectedFiles.map((file, i) => (
                  <div key={`${getDisplayName(file)}-${i}`} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm bg-muted/50">
                    <span className="truncate">{getDisplayName(file)}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                      {!isFolderUpload && (
                        <button onClick={() => removeFile(i)} className="hover:text-destructive">
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Error */}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={selectedFiles.length === 0}>
            Upload {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
