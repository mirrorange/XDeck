import { getRpcClient } from "~/lib/rpc-client";

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

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          fileName: files.length === 1 ? files[0].name : `${files.length} files`,
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.send(formData);
  });
}
