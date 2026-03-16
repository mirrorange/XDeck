import { getRpcClient } from "~/lib/rpc-client";

const CHUNK_SIZE = 1024 * 1024;
const RETRY_DELAY_MS = 3_000;
const DB_NAME = "xdeck-resumable-uploads";
const DB_VERSION = 1;
const FILE_STORE = "files";
const QUEUE_STORAGE_KEY = "xdeck_resumable_uploads";

type UploadSessionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

type UploadFileStatus =
  | "pending"
  | "running"
  | "uploaded"
  | "completed"
  | "failed"
  | "cancelled";

interface UploadFileDescriptor {
  name: string;
  size: number;
  relative_path: string | null;
  last_modified: number | null;
}

interface UploadSessionFile {
  id: string;
  file_name: string;
  relative_path: string;
  size: number;
  uploaded_bytes: number;
  status: UploadFileStatus;
  last_modified: number | null;
}

interface UploadSession {
  id: string;
  task_id: string;
  dest_path: string;
  title: string;
  status: UploadSessionStatus;
  total_files: number;
  completed_files: number;
  total_bytes: number;
  uploaded_bytes: number;
  error_message: string | null;
  files: UploadSessionFile[];
}

interface UploadSessionEnvelope {
  session: UploadSession;
}

export interface UploadResult {
  uploaded: string[];
  count: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  fileName: string;
}

type LocalUploadStatus =
  | "queued"
  | "uploading"
  | "paused"
  | "completing"
  | "completed"
  | "failed"
  | "cancelled";

interface PersistedUploadFile {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  uploadedBytes: number;
  status: UploadFileStatus;
  lastModified: number | null;
  blobKey: string;
}

interface PersistedUploadTask {
  localId: string;
  sessionId: string;
  taskId: string;
  destPath: string;
  title: string;
  totalBytes: number;
  uploadedBytes: number;
  totalFiles: number;
  completedFiles: number;
  status: LocalUploadStatus;
  error: string | null;
  files: PersistedUploadFile[];
  createdAt: number;
  updatedAt: number;
}

interface FileBlobRecord {
  key: string;
  file: Blob;
}

interface Waiter {
  resolve: (result: UploadResult) => void;
  reject: (error: Error) => void;
}

interface ProgressListener {
  callback: (progress: UploadProgress) => void;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function getApiBaseUrl(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

function getToken(): string {
  const token = getRpcClient().token;
  if (!token) {
    throw new Error("Not authenticated");
  }

  return token;
}

function normalizeRelativePath(file: File): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relativePath && relativePath.length > 0 ? relativePath : file.name;
}

function buildDescriptors(files: File[]): UploadFileDescriptor[] {
  return files.map((file) => ({
    name: file.name,
    size: file.size,
    relative_path: normalizeRelativePath(file),
    last_modified: Number.isFinite(file.lastModified) ? file.lastModified : null,
  }));
}

function buildUploadResult(session: UploadSession): UploadResult {
  return {
    uploaded: session.files.map((file) => file.relative_path),
    count: session.files.length,
  };
}

function loadPersistedTasks(): PersistedUploadTask[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as PersistedUploadTask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePersistedTasks(tasks: Map<string, PersistedUploadTask>) {
  if (typeof window === "undefined") {
    return;
  }

  const data = Array.from(tasks.values()).sort((a, b) => a.createdAt - b.createdAt);
  if (data.length === 0) {
    window.localStorage.removeItem(QUEUE_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(data));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function putFileBlobs(records: FileBlobRecord[]) {
  if (records.length === 0) {
    return;
  }

  const db = await openDatabase();
  const transaction = db.transaction(FILE_STORE, "readwrite");
  const store = transaction.objectStore(FILE_STORE);
  for (const record of records) {
    store.put(record);
  }
  await transactionToPromise(transaction);
  db.close();
}

async function getFileBlob(key: string): Promise<Blob | null> {
  const db = await openDatabase();
  const transaction = db.transaction(FILE_STORE, "readonly");
  const store = transaction.objectStore(FILE_STORE);
  const result = await requestToPromise(store.get(key));
  db.close();

  const record = result as FileBlobRecord | undefined;
  return record?.file ?? null;
}

async function deleteFileBlobs(keys: string[]) {
  if (keys.length === 0) {
    return;
  }

  const db = await openDatabase();
  const transaction = db.transaction(FILE_STORE, "readwrite");
  const store = transaction.objectStore(FILE_STORE);
  for (const key of keys) {
    store.delete(key);
  }
  await transactionToPromise(transaction);
  db.close();
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new HttpError(response.status, response.statusText || "Request failed");
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = response.statusText || "Request failed";
    try {
      const data = (await response.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      try {
        const text = await response.text();
        if (text) {
          message = text;
        }
      } catch {
        // Ignore body parsing failures.
      }
    }
    throw new HttpError(response.status, message);
  }

  return await readJson<T>(response);
}

class ResumableUploadQueue {
  private tasks = new Map<string, PersistedUploadTask>();
  private waiters = new Map<string, Waiter[]>();
  private progressListeners = new Map<string, ProgressListener[]>();
  private initPromise: Promise<void> | null = null;
  private processing = false;
  private retryTimer: number | null = null;
  private onlineListenerBound = false;

  async init() {
    if (typeof window === "undefined") {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.hydrate();
    await this.initPromise;
  }

  async enqueue(
    destPath: string,
    files: File[],
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<UploadResult> {
    await this.init();

    const token = encodeURIComponent(getToken());
    const descriptors = buildDescriptors(files);
    const response = await apiRequest<UploadSessionEnvelope>(
      `${getApiBaseUrl()}/api/files/upload/sessions?token=${token}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dest_path: destPath,
          files: descriptors,
        }),
      },
    );

    const session = response.session;
    const sourceByPath = new Map<string, File>();
    for (const file of files) {
      sourceByPath.set(normalizeRelativePath(file), file);
    }

    const blobRecords: FileBlobRecord[] = [];
    const persistedFiles: PersistedUploadFile[] = [];
    for (const file of session.files) {
      const source = sourceByPath.get(file.relative_path);
      if (!source) {
        throw new Error(`Missing source file for ${file.relative_path}`);
      }

      const blobKey = `${session.id}:${file.id}`;
      blobRecords.push({ key: blobKey, file: source });
      persistedFiles.push({
        id: file.id,
        name: file.file_name,
        relativePath: file.relative_path,
        size: file.size,
        uploadedBytes: file.uploaded_bytes,
        status: file.status,
        lastModified: file.last_modified,
        blobKey,
      });
    }

    await putFileBlobs(blobRecords);

    const task: PersistedUploadTask = {
      localId: session.id,
      sessionId: session.id,
      taskId: session.task_id,
      destPath: session.dest_path,
      title: session.title,
      totalBytes: session.total_bytes,
      uploadedBytes: session.uploaded_bytes,
      totalFiles: session.total_files,
      completedFiles: session.completed_files,
      status: "queued",
      error: null,
      files: persistedFiles,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(task.localId, task);
    this.persist();

    if (onProgress) {
      const listeners = this.progressListeners.get(task.localId) ?? [];
      listeners.push({ callback: onProgress });
      this.progressListeners.set(task.localId, listeners);
    }

    this.schedule();
    return await this.waitForCompletion(task.localId);
  }

  private async hydrate() {
    const persisted = loadPersistedTasks();
    this.tasks = new Map(persisted.map((task) => [task.localId, task]));

    if (!this.onlineListenerBound) {
      window.addEventListener("online", this.handleOnline);
      this.onlineListenerBound = true;
    }

    for (const task of this.tasks.values()) {
      if (this.isTerminal(task.status)) {
        continue;
      }
      try {
        const session = await this.fetchSession(task.sessionId);
        this.applySessionToTask(task, session);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to restore upload";
        task.status = "paused";
        task.error = message;
        task.updatedAt = Date.now();
      }
    }

    this.persist();
    this.schedule();
  }

  private handleOnline = () => {
    this.schedule(true);
  };

  private persist() {
    savePersistedTasks(this.tasks);
  }

  private schedule(immediate = false) {
    if (typeof window === "undefined") {
      return;
    }
    if (this.processing) {
      return;
    }
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (immediate) {
      void this.processQueue();
      return;
    }

    queueMicrotask(() => {
      void this.processQueue();
    });
  }

  private scheduleRetry() {
    if (typeof window === "undefined") {
      return;
    }
    if (this.retryTimer != null || !this.hasPendingTask()) {
      return;
    }
    if (!window.navigator.onLine) {
      return;
    }

    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.schedule(true);
    }, RETRY_DELAY_MS);
  }

  private hasPendingTask() {
    for (const task of this.tasks.values()) {
      if (!this.isTerminal(task.status)) {
        return true;
      }
    }
    return false;
  }

  private async processQueue() {
    if (this.processing) {
      return;
    }
    this.processing = true;

    try {
      while (true) {
        const nextTask = Array.from(this.tasks.values()).find(
          (task) => !this.isTerminal(task.status),
        );
        if (!nextTask) {
          break;
        }

        const outcome = await this.processTask(nextTask.localId);
        if (outcome === "retry") {
          break;
        }
      }
    } finally {
      this.processing = false;
      if (this.hasPendingTask()) {
        this.scheduleRetry();
      }
    }
  }

  private async processTask(localId: string): Promise<"done" | "retry"> {
    const current = this.tasks.get(localId);
    if (!current || this.isTerminal(current.status)) {
      return "done";
    }

    let session: UploadSession;
    try {
      session = await this.fetchSession(current.sessionId);
    } catch (error) {
      current.status = "paused";
      current.error = error instanceof Error ? error.message : "Failed to fetch upload session";
      current.updatedAt = Date.now();
      this.persist();
      return "retry";
    }

    this.applySessionToTask(current, session);

    if (session.status === "completed") {
      await this.finishCompletedTask(current.localId, session);
      return "done";
    }
    if (session.status === "cancelled") {
      await this.finishCancelledTask(current.localId);
      return "done";
    }

    current.status = "uploading";
    current.error = null;
    current.updatedAt = Date.now();
    this.persist();

    for (const file of current.files) {
      const serverFile = session.files.find((entry) => entry.id === file.id);
      if (!serverFile) {
        await this.failTask(current.localId, `Upload file missing on server: ${file.relativePath}`);
        return "done";
      }

      file.uploadedBytes = serverFile.uploaded_bytes;
      file.status = serverFile.status;
      if (serverFile.uploaded_bytes >= serverFile.size) {
        continue;
      }

      const blob = await getFileBlob(file.blobKey);
      if (!blob) {
        await this.failTask(
          current.localId,
          `Local upload data is no longer available for ${file.relativePath}`,
        );
        return "done";
      }

      let offset = serverFile.uploaded_bytes;
      while (offset < file.size) {
        const task = this.tasks.get(localId);
        if (!task || this.isTerminal(task.status)) {
          return "done";
        }

        const chunk = blob.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
        try {
          const result = await this.uploadChunk(task.sessionId, file.id, offset, chunk);
          offset = result.uploaded_bytes;
          this.applyChunkResult(task, file.id, result);
          this.emitProgress(task, file.relativePath);
        } catch (error) {
          if (error instanceof HttpError && error.status === 400) {
            session = await this.fetchSession(task.sessionId);
            this.applySessionToTask(task, session);
            const refreshed = session.files.find((entry) => entry.id === file.id);
            if (!refreshed) {
              await this.failTask(task.localId, `Upload file missing on server: ${file.relativePath}`);
              return "done";
            }
            offset = refreshed.uploaded_bytes;
            continue;
          }

          if (this.isRetryableError(error)) {
            task.status = "paused";
            task.error = error instanceof Error ? error.message : "Upload temporarily unavailable";
            task.updatedAt = Date.now();
            this.persist();
            return "retry";
          }

          await this.failTask(
            task.localId,
            error instanceof Error ? error.message : "Upload failed",
          );
          return "done";
        }
      }
    }

    const task = this.tasks.get(localId);
    if (!task) {
      return "done";
    }
    task.status = "completing";
    task.error = null;
    task.updatedAt = Date.now();
    this.persist();

    try {
      const completed = await this.completeSession(task.sessionId);
      await this.finishCompletedTask(task.localId, completed);
      return "done";
    } catch (error) {
      if (this.isRetryableError(error)) {
        task.status = "paused";
        task.error = error instanceof Error ? error.message : "Upload completion temporarily unavailable";
        task.updatedAt = Date.now();
        this.persist();
        return "retry";
      }

      await this.failTask(
        task.localId,
        error instanceof Error ? error.message : "Failed to finalize upload",
      );
      return "done";
    }
  }

  private applySessionToTask(task: PersistedUploadTask, session: UploadSession) {
    task.taskId = session.task_id;
    task.title = session.title;
    task.totalBytes = session.total_bytes;
    task.uploadedBytes = session.uploaded_bytes;
    task.totalFiles = session.total_files;
    task.completedFiles = session.completed_files;
    task.error = session.error_message;
    task.updatedAt = Date.now();

    const fileMap = new Map(session.files.map((file) => [file.id, file]));
    for (const file of task.files) {
      const serverFile = fileMap.get(file.id);
      if (!serverFile) {
        continue;
      }
      file.uploadedBytes = serverFile.uploaded_bytes;
      file.status = serverFile.status;
    }

    if (session.status === "completed") {
      task.status = "completed";
    } else if (session.status === "cancelled") {
      task.status = "cancelled";
    } else if (task.status !== "failed") {
      task.status = task.uploadedBytes > 0 ? "paused" : "queued";
    }
    this.persist();
  }

  private applyChunkResult(
    task: PersistedUploadTask,
    fileId: string,
    result: {
      uploaded_bytes: number;
      session_uploaded_bytes: number;
      completed_files: number;
      total_files: number;
    },
  ) {
    const file = task.files.find((entry) => entry.id === fileId);
    if (file) {
      file.uploadedBytes = result.uploaded_bytes;
      file.status = file.uploadedBytes >= file.size ? "uploaded" : "running";
    }

    task.uploadedBytes = result.session_uploaded_bytes;
    task.completedFiles = result.completed_files;
    task.totalFiles = result.total_files;
    task.error = null;
    task.updatedAt = Date.now();
    this.persist();
  }

  private emitProgress(task: PersistedUploadTask, relativePath: string) {
    const listeners = this.progressListeners.get(task.localId);
    if (!listeners || listeners.length === 0) {
      return;
    }

    const progress: UploadProgress = {
      loaded: task.uploadedBytes,
      total: task.totalBytes,
      fileName: relativePath,
    };
    for (const listener of listeners) {
      listener.callback(progress);
    }
  }

  private async finishCompletedTask(localId: string, session: UploadSession) {
    const task = this.tasks.get(localId);
    if (!task) {
      return;
    }

    const result = buildUploadResult(session);
    await this.cleanupTask(task);
    this.resolveWaiters(localId, result);
  }

  private async finishCancelledTask(localId: string) {
    const task = this.tasks.get(localId);
    if (!task) {
      return;
    }

    await this.cleanupTask(task);
    this.rejectWaiters(localId, new Error("Upload cancelled"));
  }

  private async failTask(localId: string, message: string) {
    const task = this.tasks.get(localId);
    if (!task) {
      return;
    }

    task.status = "failed";
    task.error = message;
    task.updatedAt = Date.now();
    this.persist();
    this.rejectWaiters(localId, new Error(message));
  }

  private async cleanupTask(task: PersistedUploadTask) {
    this.tasks.delete(task.localId);
    this.progressListeners.delete(task.localId);
    this.persist();
    await deleteFileBlobs(task.files.map((file) => file.blobKey));
  }

  private waitForCompletion(localId: string): Promise<UploadResult> {
    const existing = this.tasks.get(localId);
    if (!existing) {
      return Promise.reject(new Error("Upload session not found"));
    }

    return new Promise((resolve, reject) => {
      const current = this.waiters.get(localId) ?? [];
      current.push({ resolve, reject });
      this.waiters.set(localId, current);
    });
  }

  private resolveWaiters(localId: string, result: UploadResult) {
    const waiters = this.waiters.get(localId) ?? [];
    for (const waiter of waiters) {
      waiter.resolve(result);
    }
    this.waiters.delete(localId);
  }

  private rejectWaiters(localId: string, error: Error) {
    const waiters = this.waiters.get(localId) ?? [];
    for (const waiter of waiters) {
      waiter.reject(error);
    }
    this.waiters.delete(localId);
  }

  private isRetryableError(error: unknown) {
    if (error instanceof TypeError) {
      return true;
    }
    if (error instanceof HttpError) {
      return error.status >= 500 || error.status === 408 || error.status === 429;
    }
    return false;
  }

  private isTerminal(status: LocalUploadStatus) {
    return status === "completed" || status === "failed" || status === "cancelled";
  }

  private async fetchSession(sessionId: string): Promise<UploadSession> {
    const token = encodeURIComponent(getToken());
    const response = await apiRequest<UploadSessionEnvelope>(
      `${getApiBaseUrl()}/api/files/upload/sessions/${encodeURIComponent(sessionId)}?token=${token}`,
    );
    return response.session;
  }

  private async uploadChunk(
    sessionId: string,
    fileId: string,
    offset: number,
    chunk: Blob,
  ): Promise<{
    uploaded_bytes: number;
    session_uploaded_bytes: number;
    completed_files: number;
    total_files: number;
  }> {
    const token = encodeURIComponent(getToken());
    return await apiRequest(
      `${getApiBaseUrl()}/api/files/upload/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}/chunk?token=${token}&offset=${offset}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: chunk,
      },
    );
  }

  private async completeSession(sessionId: string): Promise<UploadSession> {
    const token = encodeURIComponent(getToken());
    const response = await apiRequest<UploadSessionEnvelope>(
      `${getApiBaseUrl()}/api/files/upload/sessions/${encodeURIComponent(sessionId)}/complete?token=${token}`,
      {
        method: "POST",
      },
    );
    return response.session;
  }
}

let queueInstance: ResumableUploadQueue | null = null;

function getQueue() {
  if (!queueInstance) {
    queueInstance = new ResumableUploadQueue();
  }
  return queueInstance;
}

export async function initializeResumableUploads() {
  await getQueue().init();
}

export async function uploadFilesResumable(
  destPath: string,
  files: FileList | File[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  const list = Array.from(files);
  return await getQueue().enqueue(destPath, list, onProgress);
}
