import { useCallback, useRef, useState } from "react";
import type { FileEntry } from "~/stores/file-store";

// ── Constants ──────────────────────────────────────────────────────────────

export const XDECK_MIME = "application/x-xdeck-files";

/** How close to the edge (px) before auto-scrolling starts */
const EDGE_SCROLL_ZONE = 40;
/** Auto-scroll speed in px per frame */
const EDGE_SCROLL_SPEED = 8;

// ── Custom drag preview ────────────────────────────────────────────────────

/**
 * Create a custom drag preview element showing the file count and names.
 * Returns a cleanup function to remove the element from the DOM.
 */
export function setDragPreview(
  e: React.DragEvent,
  entries: FileEntry[],
  selectedPaths: Set<string>,
): () => void {
  const paths = selectedPaths.has(entries[0]?.path ?? "")
    ? [...selectedPaths]
    : entries.map((en) => en.path);

  const count = paths.length;
  if (count === 0) return () => {};

  const el = document.createElement("div");
  el.className = "xdeck-drag-preview";
  el.style.cssText = `
    position: fixed;
    top: -1000px;
    left: -1000px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    background: var(--popover, hsl(240 10% 10%));
    border: 1px solid var(--border, hsl(240 6% 20%));
    border-radius: 6px;
    color: var(--popover-foreground, hsl(0 0% 95%));
    font-size: 12px;
    font-family: inherit;
    pointer-events: none;
    max-width: 200px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;

  if (count === 1) {
    const name = paths[0].split("/").pop() ?? "file";
    el.textContent = name;
  } else {
    const badge = document.createElement("div");
    badge.style.fontWeight = "600";
    badge.textContent = `${count} items`;
    el.appendChild(badge);

    // Show first 3 names
    const display = paths.slice(0, 3);
    for (const p of display) {
      const line = document.createElement("div");
      line.style.cssText = "opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      line.textContent = p.split("/").pop() ?? "";
      el.appendChild(line);
    }
    if (count > 3) {
      const more = document.createElement("div");
      more.style.opacity = "0.5";
      more.textContent = `… and ${count - 3} more`;
      el.appendChild(more);
    }
  }

  document.body.appendChild(el);
  e.dataTransfer.setDragImage(el, 0, 0);

  return () => {
    // Delay removal to ensure the browser has captured the image
    requestAnimationFrame(() => {
      el.remove();
    });
  };
}

// ── Shared DnD hooks ───────────────────────────────────────────────────────

interface UseDndOptions {
  tabId: string;
  selectedPaths: Set<string>;
  entries: FileEntry[];
  selectFile: (tabId: string, path: string, toggle: boolean) => void;
  onDropFiles?: (targetDir: string, sourcePaths: string[]) => void;
}

export function useFileDnd({
  tabId,
  selectedPaths,
  entries,
  selectFile,
  onDropFiles,
}: UseDndOptions) {
  const dragPreviewCleanup = useRef<(() => void) | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, entry: FileEntry) => {
      if (!selectedPaths.has(entry.path)) {
        selectFile(tabId, entry.path, false);
      }
      const paths = selectedPaths.has(entry.path)
        ? [...selectedPaths]
        : [entry.path];

      e.dataTransfer.setData(XDECK_MIME, JSON.stringify(paths));
      e.dataTransfer.effectAllowed = "move";

      // Set custom drag preview
      const selectedEntries = entries.filter((en) => paths.includes(en.path));
      dragPreviewCleanup.current = setDragPreview(
        e,
        selectedEntries.length > 0 ? selectedEntries : [entry],
        selectedPaths
      );
    },
    [tabId, selectedPaths, entries, selectFile]
  );

  const handleDragEnd = useCallback(() => {
    dragPreviewCleanup.current?.();
    dragPreviewCleanup.current = null;
    setDragOverPath(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, entry: FileEntry) => {
      if (entry.type !== "directory") return;
      if (e.dataTransfer.types.includes(XDECK_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverPath(entry.path);
      }
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverPath(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, entry: FileEntry) => {
      if (entry.type !== "directory") return;
      e.preventDefault();
      e.stopPropagation(); // Prevent scroll area background handler from also firing
      setDragOverPath(null);
      const data = e.dataTransfer.getData(XDECK_MIME);
      if (data) {
        try {
          const paths: string[] = JSON.parse(data);
          onDropFiles?.(entry.path, paths);
        } catch {
          // invalid data
        }
      }
    },
    [onDropFiles]
  );

  return {
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    dragOverPath,
  };
}

// ── Edge scrolling ─────────────────────────────────────────────────────────

/**
 * Hook for auto-scrolling when dragging near the edges of a scroll container.
 * Returns a ref to attach to the scroll container, plus dragOver/leave handlers.
 */
export function useEdgeScroll() {
  const scrollRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const startScrolling = useCallback((direction: "up" | "down") => {
    const scroll = () => {
      const el = scrollRef.current;
      if (!el) return;
      const delta = direction === "up" ? -EDGE_SCROLL_SPEED : EDGE_SCROLL_SPEED;
      el.scrollTop += delta;
      rafRef.current = requestAnimationFrame(scroll);
    };
    stopScrolling();
    rafRef.current = requestAnimationFrame(scroll);
  }, []);

  const stopScrolling = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const handleDragOverContainer = useCallback(
    (e: React.DragEvent) => {
      const el = scrollRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const y = e.clientY;

      if (y - rect.top < EDGE_SCROLL_ZONE) {
        startScrolling("up");
      } else if (rect.bottom - y < EDGE_SCROLL_ZONE) {
        startScrolling("down");
      } else {
        stopScrolling();
      }
    },
    [startScrolling, stopScrolling]
  );

  const handleDragLeaveContainer = useCallback(() => {
    stopScrolling();
  }, [stopScrolling]);

  return {
    scrollRef,
    handleDragOverContainer,
    handleDragLeaveContainer,
    stopScrolling,
  };
}
