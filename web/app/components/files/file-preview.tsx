import { useEffect, useRef, useState } from "react";
import { X, Loader2, FileText, ImageIcon, Film, Music } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import type { Extension } from "@codemirror/state";

import { Button } from "~/components/ui/button";
import { getRpcClient } from "~/lib/rpc-client";
import { getFileCategory, getFileExtension, formatFileSize } from "~/lib/file-utils";
import type { FileEntry } from "~/stores/file-store";

interface FilePreviewProps {
  entry: FileEntry;
  onClose: () => void;
}

function getLanguageExtension(ext: string): Extension | null {
  switch (ext) {
    case "js":
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "py":
      return python();
    case "json":
      return json();
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return html();
    case "css":
    case "scss":
    case "less":
      return css();
    case "md":
    case "mdx":
      return markdown();
    case "rs":
      return rust();
    case "xml":
    case "svg":
      return xml();
    case "sql":
      return sql();
    case "yaml":
    case "yml":
      return yaml();
    case "java":
      return java();
    case "c":
    case "cpp":
    case "h":
    case "hpp":
      return cpp();
    case "php":
      return php();
    case "go":
      return go();
    default:
      return null;
  }
}

export function FilePreview({ entry, onClose }: FilePreviewProps) {
  const category = getFileCategory(entry.type, entry.name);

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2 min-w-0">
          {category === "image" && <ImageIcon className="size-4 shrink-0" />}
          {category === "video" && <Film className="size-4 shrink-0" />}
          {category === "audio" && <Music className="size-4 shrink-0" />}
          {(category === "code" || category === "text") && (
            <FileText className="size-4 shrink-0" />
          )}
          <span className="truncate text-sm font-medium">{entry.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(entry.size)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {(category === "code" || category === "text") && (
          <CodePreview path={entry.path} name={entry.name} />
        )}
        {category === "image" && <ImagePreview path={entry.path} />}
        {category === "video" && <VideoPreview path={entry.path} />}
        {category === "audio" && <AudioPreview path={entry.path} />}
      </div>
    </div>
  );
}

// ── Code Preview ────────────────────────────────────────────────

function CodePreview({ path, name }: { path: string; name: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const rpc = getRpcClient();
        const result = (await rpc.call("fs.read_file", { path })) as {
          content: string;
        };

        if (cancelled) return;

        // Cleanup previous editor
        if (viewRef.current) {
          viewRef.current.destroy();
          viewRef.current = null;
        }

        const ext = getFileExtension(name);
        const langExt = getLanguageExtension(ext);

        const extensions: Extension[] = [
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          oneDark,
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-gutters": { minWidth: "3em" },
          }),
        ];

        if (langExt) extensions.push(langExt);

        const state = EditorState.create({
          doc: result.content,
          extensions,
        });

        if (editorRef.current) {
          viewRef.current = new EditorView({
            state,
            parent: editorRef.current,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load file");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [path, name]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground p-4">
        <FileText className="size-8" />
        <p className="text-sm text-center">{error}</p>
      </div>
    );
  }

  return <div ref={editorRef} className="h-full" />;
}

// ── Image Preview ───────────────────────────────────────────────

function ImagePreview({ path }: { path: string }) {
  const token = getRpcClient().token;
  const url = `/api/files/download?token=${encodeURIComponent(token ?? "")}&path=${encodeURIComponent(path)}`;

  return (
    <div className="flex h-full items-center justify-center p-4 bg-muted/30">
      <img
        src={url}
        alt="Preview"
        className="max-h-full max-w-full object-contain rounded"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}

// ── Video Preview ───────────────────────────────────────────────

function VideoPreview({ path }: { path: string }) {
  const token = getRpcClient().token;
  const url = `/api/files/download?token=${encodeURIComponent(token ?? "")}&path=${encodeURIComponent(path)}`;

  return (
    <div className="flex h-full items-center justify-center p-4 bg-black">
      <video
        src={url}
        controls
        className="max-h-full max-w-full"
      />
    </div>
  );
}

// ── Audio Preview ───────────────────────────────────────────────

function AudioPreview({ path }: { path: string }) {
  const token = getRpcClient().token;
  const url = `/api/files/download?token=${encodeURIComponent(token ?? "")}&path=${encodeURIComponent(path)}`;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex flex-col items-center gap-4">
        <Music className="size-16 text-muted-foreground" />
        <audio src={url} controls className="w-72" />
      </div>
    </div>
  );
}
