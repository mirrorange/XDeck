import { getRpcClient } from "~/lib/rpc-client";
import { uploadFilesResumable, type UploadProgress, type UploadResult } from "~/lib/resumable-upload";

/**
 * Build the base URL for HTTP API calls.
 */
function getApiBaseUrl(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

/**
 * Get the current auth token from the RPC client.
 */
function getToken(): string {
  const token = getRpcClient().token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

/**
 * Download a file by triggering a browser download via a hidden link.
 */
export function downloadFile(path: string): void {
  const token = getToken();
  const url = `${getApiBaseUrl()}/api/files/download?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`;

  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Download a folder by requesting the server to prepare a zip, then downloading it.
 * Uses RPC `fs.prepare_download` which creates a temp zip with progress tracking.
 */
export async function downloadFolder(path: string): Promise<void> {
  const rpc = getRpcClient();
  const result = await rpc.call<{ download_path: string; task_id: string }>(
    "fs.prepare_download",
    { path }
  );
  // The server returns the path to the temp zip file — download it
  downloadFile(result.download_path);
}

/**
 * Upload files to a directory on the server.
 * Progress is tracked in the task list panel.
 */
export async function uploadFiles(
  destPath: string,
  files: FileList | File[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  return await uploadFilesResumable(destPath, files, onProgress);
}

/**
 * Upload files preserving directory structure (folder upload).
 * Each file is preceded by a `relative_path` form field indicating its position
 * within the folder hierarchy. Progress is tracked in the task list panel.
 */
export async function uploadFolder(
  destPath: string,
  files: FileList | File[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  return await uploadFilesResumable(destPath, files, onProgress);
}
