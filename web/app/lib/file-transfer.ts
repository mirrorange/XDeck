import { getRpcClient } from "~/lib/rpc-client";
import { useTaskStore } from "~/stores/task-store";

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

/** Generate a unique client-side task id */
let clientTaskSeq = 0;
function nextClientTaskId(): string {
  return `client-upload-${++clientTaskSeq}-${Date.now()}`;
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

export interface UploadProgress {
  loaded: number;
  total: number;
  fileName: string;
}

export interface UploadResult {
  uploaded: string[];
  count: number;
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
  const token = getToken();
  const url = `${getApiBaseUrl()}/api/files/upload?token=${encodeURIComponent(token)}&path=${encodeURIComponent(destPath)}`;

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }

  const fileCount = Array.from(files).length;
  const taskTitle = fileCount === 1 ? `Uploading ${files[0].name}` : `Uploading ${fileCount} files`;
  const taskId = nextClientTaskId();
  const taskStore = useTaskStore.getState();
  taskStore.addClientTask(taskId, "upload", taskTitle);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        taskStore.updateClientTask(taskId, {
          progress: Math.min(pct, 99),
          message: `${pct}%`,
        });
        onProgress?.({
          loaded: e.loaded,
          total: e.total,
          fileName: fileCount === 1 ? files[0].name : `${fileCount} files`,
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const result: UploadResult = JSON.parse(xhr.responseText);
        taskStore.updateClientTask(taskId, {
          status: "completed",
          progress: 100,
          message: `${result.count} file${result.count !== 1 ? "s" : ""} uploaded`,
        });
        resolve(result);
      } else {
        taskStore.updateClientTask(taskId, {
          status: "failed",
          message: `${xhr.status} ${xhr.statusText}`,
        });
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      taskStore.updateClientTask(taskId, {
        status: "failed",
        message: "Network error",
      });
      reject(new Error("Upload failed: network error"));
    };
    xhr.send(formData);
  });
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
  const token = getToken();
  const url = `${getApiBaseUrl()}/api/files/upload?token=${encodeURIComponent(token)}&path=${encodeURIComponent(destPath)}`;

  const formData = new FormData();
  for (const file of files) {
    // webkitRelativePath contains the full relative path including the root folder name
    // e.g. "my-folder/sub/file.txt"
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (relativePath) {
      formData.append("relative_path", relativePath);
    }
    formData.append("files", file, file.name);
  }

  const fileCount = Array.from(files).length;
  const folderName = fileCount > 0
    ? (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] ?? "folder"
    : "folder";
  const taskTitle = `Uploading folder: ${folderName}`;
  const taskId = nextClientTaskId();
  const taskStore = useTaskStore.getState();
  taskStore.addClientTask(taskId, "upload", taskTitle);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        taskStore.updateClientTask(taskId, {
          progress: Math.min(pct, 99),
          message: `${pct}% (${fileCount} files)`,
        });
        onProgress?.({
          loaded: e.loaded,
          total: e.total,
          fileName: `folder (${fileCount} files)`,
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const result: UploadResult = JSON.parse(xhr.responseText);
        taskStore.updateClientTask(taskId, {
          status: "completed",
          progress: 100,
          message: `${result.count} file${result.count !== 1 ? "s" : ""} uploaded`,
        });
        resolve(result);
      } else {
        taskStore.updateClientTask(taskId, {
          status: "failed",
          message: `${xhr.status} ${xhr.statusText}`,
        });
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      taskStore.updateClientTask(taskId, {
        status: "failed",
        message: "Network error",
      });
      reject(new Error("Upload failed: network error"));
    };
    xhr.send(formData);
  });
}
