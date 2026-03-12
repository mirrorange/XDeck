import type { FileType } from "~/stores/file-store";

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = 24 * 60 * 60 * 1000;

  if (diff < day) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (diff < 365 * day) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatPermissions(mode: number | null): string {
  if (mode === null) return "—";
  const perms = mode & 0o777;
  const chars = "rwxrwxrwx";
  let result = "";
  for (let i = 8; i >= 0; i--) {
    result += perms & (1 << i) ? chars[8 - i] : "-";
  }
  return result;
}

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "svg", "webp", "ico", "bmp"]);
const videoExtensions = new Set(["mp4", "webm", "mkv", "avi", "mov"]);
const audioExtensions = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]);
const archiveExtensions = new Set(["zip", "tar", "gz", "bz2", "xz", "7z", "rar", "tgz"]);
const codeExtensions = new Set([
  "js", "ts", "jsx", "tsx", "json", "html", "css", "scss", "less",
  "py", "rb", "rs", "go", "java", "c", "cpp", "h", "hpp",
  "sh", "bash", "zsh", "fish", "ps1",
  "yaml", "yml", "toml", "xml", "md", "mdx",
  "sql", "graphql", "proto",
  "vue", "svelte", "astro",
  "Dockerfile", "Makefile", "Cargo.toml",
]);

export type FileCategory =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "text"
  | "binary";

export function getFileCategory(type: FileType, name: string): FileCategory {
  if (type === "directory") return "folder";

  const ext = getFileExtension(name);
  if (imageExtensions.has(ext)) return "image";
  if (videoExtensions.has(ext)) return "video";
  if (audioExtensions.has(ext)) return "audio";
  if (archiveExtensions.has(ext)) return "archive";
  if (codeExtensions.has(ext)) return "code";
  if (ext === "txt" || ext === "log" || ext === "csv" || ext === "ini" || ext === "cfg" || ext === "conf") return "text";

  return "binary";
}

export function isPreviewable(type: FileType, name: string): boolean {
  const cat = getFileCategory(type, name);
  return cat === "image" || cat === "video" || cat === "audio" || cat === "code" || cat === "text";
}
