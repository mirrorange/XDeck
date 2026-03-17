import { useCallback, useRef, useState } from "react";
import { FolderUp, Upload, X } from "lucide-react";

import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "~/components/responsive-modal";
import { Button } from "~/components/ui/button";
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
    <ResponsiveModal open={open} onOpenChange={handleOpenChange}>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Upload {isFolderUpload ? "Folder" : "Files"}</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Choose files or a folder to upload.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 md:px-0">
          <p className="break-all text-sm text-muted-foreground">
            Upload to: <span className="font-mono text-foreground">{currentPath}</span>
          </p>

          {/* File/Folder input area */}
          {selectedFiles.length === 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <>
                <button
                  type="button"
                  className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-8 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Select Files</p>
                    <p className="text-xs text-muted-foreground">Choose one or more files</p>
                  </div>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </>
              <>
                <button
                  type="button"
                  className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
                  onClick={() => folderInputRef.current?.click()}
                >
                  <FolderUp className="size-8 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Select Folder</p>
                    <p className="text-xs text-muted-foreground">Preserve the folder structure</p>
                  </div>
                </button>
                <input
                  ref={folderInputRef}
                  type="file"
                  /* @ts-expect-error webkitdirectory is not in the type definitions */
                  webkitdirectory=""
                  className="hidden"
                  onChange={handleFolderSelect}
                />
              </>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
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
                <p className="text-xs text-muted-foreground">Choose a different selection</p>
              </button>
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
            </>
          )}

          {/* Selected files summary */}
          {selectedFiles.length > 0 && (
            <>
              {isFolderUpload && folderName && (
                <p className="text-sm font-medium">
                  Folder: <span className="break-all font-mono">{folderName}</span>
                  <span className="text-muted-foreground ml-1">
                    ({selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""})
                  </span>
                </p>
              )}
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
                {selectedFiles.map((file, i) => (
                  <div
                    key={`${getDisplayName(file)}-${i}`}
                    className="flex min-w-0 items-center justify-between gap-2 rounded bg-background px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate" title={getDisplayName(file)}>
                      {getDisplayName(file)}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                      {!isFolderUpload && (
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="hover:text-destructive"
                          aria-label={`Remove ${file.name}`}
                        >
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

        <ResponsiveModalFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={selectedFiles.length === 0}>
            Upload {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
