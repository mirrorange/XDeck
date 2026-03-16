import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Link,
} from "lucide-react";

import { getFileCategory, type FileCategory } from "~/lib/file-utils";
import type { FileType } from "~/stores/file-store";
import { cn } from "~/lib/utils";

const categoryColors: Record<FileCategory, string> = {
  folder: "text-amber-500",
  image: "text-pink-500",
  video: "text-purple-500",
  audio: "text-green-500",
  archive: "text-orange-500",
  code: "text-blue-500",
  text: "text-muted-foreground",
  binary: "text-muted-foreground",
};

const categoryIcons: Record<FileCategory, React.ComponentType<{ className?: string }>> = {
  folder: Folder,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  code: FileCode,
  text: FileText,
  binary: File,
};

interface FileIconProps {
  type: FileType;
  name: string;
  isOpen?: boolean;
  className?: string;
}

export function FileIcon({ type, name, isOpen, className }: FileIconProps) {
  if (type === "symlink") {
    return <Link className={cn("text-cyan-500", className)} />;
  }

  const category = getFileCategory(type, name);

  if (category === "folder" && isOpen) {
    return <FolderOpen className={cn(categoryColors.folder, className)} />;
  }

  const Icon = categoryIcons[category];
  return <Icon className={cn(categoryColors[category], className)} />;
}
