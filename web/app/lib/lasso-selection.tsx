import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LassoState {
  /** Whether a lasso selection is currently active */
  active: boolean;
  /** The visible lasso rectangle (in viewport coordinates) */
  rect: Rect | null;
}

interface UseLassoSelectionOptions {
  /** Container ref for the scrollable area that holds the file items */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Selector for individual file items within the container */
  itemSelector: string;
  /** Callback to get the file path from a DOM element */
  getPathFromElement: (el: Element) => string | null;
  /** Callback when selected paths change during lasso */
  onSelect: (paths: Set<string>, additive: boolean) => void;
  /** Whether the lasso is enabled */
  enabled?: boolean;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useLassoSelection({
  containerRef,
  itemSelector,
  getPathFromElement,
  onSelect,
  enabled = true,
}: UseLassoSelectionOptions): LassoState {
  const [state, setState] = useState<LassoState>({ active: false, rect: null });
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const additiveRef = useRef(false);
  const activeRef = useRef(false);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;
      // Only start lasso on left-click in empty space
      if (e.button !== 0) return;

      const target = e.target as HTMLElement;
      // Don't start lasso if clicking on a file item, button, or input
      if (
        target.closest("[data-slot='table-row']") ||
        target.closest("[data-lasso-item]") ||
        target.closest("button") ||
        target.closest("input") ||
        target.closest("[data-slot='context-menu']")
      ) {
        return;
      }

      // Don't start lasso on scrollbar clicks
      const container = containerRef.current;
      if (!container) return;

      e.preventDefault();
      startPoint.current = { x: e.clientX, y: e.clientY };
      additiveRef.current = e.shiftKey || e.metaKey || e.ctrlKey;
      activeRef.current = false;
    },
    [containerRef, enabled]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!startPoint.current) return;

      const dx = e.clientX - startPoint.current.x;
      const dy = e.clientY - startPoint.current.y;

      // Only activate after a small threshold to avoid accidental lassos
      if (!activeRef.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) {
        return;
      }
      activeRef.current = true;

      const rect: Rect = {
        x: Math.min(startPoint.current.x, e.clientX),
        y: Math.min(startPoint.current.y, e.clientY),
        width: Math.abs(dx),
        height: Math.abs(dy),
      };

      setState({ active: true, rect });

      // Find intersecting items
      const container = containerRef.current;
      if (!container) return;

      const items = container.querySelectorAll(itemSelector);
      const selectedPaths = new Set<string>();

      for (const item of items) {
        const itemRect = item.getBoundingClientRect();
        if (rectsIntersect(rect, itemRect)) {
          const path = getPathFromElement(item);
          if (path) selectedPaths.add(path);
        }
      }

      onSelect(selectedPaths, additiveRef.current);
    },
    [containerRef, itemSelector, getPathFromElement, onSelect]
  );

  const handleMouseUp = useCallback(() => {
    if (startPoint.current) {
      startPoint.current = null;
      activeRef.current = false;
      setState({ active: false, rect: null });
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [containerRef, enabled, handleMouseDown, handleMouseMove, handleMouseUp]);

  return state;
}

// ── Lasso overlay component ────────────────────────────────────────────────

export function LassoOverlay({ rect }: { rect: Rect | null }) {
  if (!rect) return null;

  return (
    <div
      className="fixed pointer-events-none z-40 border border-primary/60 bg-primary/10 rounded-sm"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function rectsIntersect(a: Rect, b: DOMRect): boolean {
  return !(
    a.x + a.width < b.left ||
    a.x > b.right ||
    a.y + a.height < b.top ||
    a.y > b.bottom
  );
}
