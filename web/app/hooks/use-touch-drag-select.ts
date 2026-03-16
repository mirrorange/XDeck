import { useCallback, useEffect, useRef } from "react";
import type { FileEntry } from "~/stores/file-store";

interface UseTouchDragSelectOptions {
  /** Ordered list of entries currently displayed */
  entries: FileEntry[];
  /** Whether multi-select mode is active */
  multiSelectMode: boolean;
  /** Whether this is a mobile device */
  isMobile: boolean;
  /** Called with the set of paths that should be selected during drag */
  onDragSelect: (paths: Set<string>) => void;
  /** Called when long-press fires (enters multi-select + selects anchor) */
  onLongPress: (entry: FileEntry) => void;
  /** Item selector for finding items via elementFromPoint */
  itemSelector: string;
}

/**
 * Hook for touch-drag range selection on mobile.
 *
 * Two modes:
 * 1. Long-press initiates multi-select, then continued drag selects a range
 *    from the anchor item to wherever the finger is.
 * 2. In multi-select mode, starting a touch on an item and dragging selects
 *    the range from the touched item to wherever the finger moves.
 *
 * Returns touch handlers to attach to each item element.
 */
export function useTouchDragSelect({
  entries,
  multiSelectMode,
  isMobile,
  onDragSelect,
  onLongPress,
  itemSelector,
}: UseTouchDragSelectOptions) {
  // Long-press timer
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether long press fired (to suppress the subsequent click event)
  const longPressFiredRef = useRef(false);
  // Index of the anchor item for range selection
  const anchorIndexRef = useRef<number | null>(null);
  // Whether a drag-select is currently active
  const dragActiveRef = useRef(false);
  // Track touch start position for movement threshold
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  // Last index during drag to avoid redundant setSelection calls
  const lastDragIndexRef = useRef<number | null>(null);
  // Paths selected before drag started (to preserve pre-existing selection)
  const preSelectionRef = useRef<Set<string>>(new Set());

  // Keep fresh refs for values used in the native touchmove listener
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const multiSelectModeRef = useRef(multiSelectMode);
  multiSelectModeRef.current = multiSelectMode;
  const onDragSelectRef = useRef(onDragSelect);
  onDragSelectRef.current = onDragSelect;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  /**
   * Given a touch point, find the file entry item element under it
   * and return its index in the entries array.
   */
  const getEntryIndexAtPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;
      const itemEl = el.closest(itemSelector);
      if (!itemEl) return null;
      const path = itemEl.getAttribute("data-path");
      if (!path) return null;
      const currentEntries = entriesRef.current;
      const idx = currentEntries.findIndex((e) => e.path === path);
      return idx >= 0 ? idx : null;
    },
    [itemSelector]
  );

  /**
   * Select the range from anchorIndex to currentIndex (inclusive).
   */
  const selectRange = useCallback(
    (currentIndex: number) => {
      const anchor = anchorIndexRef.current;
      if (anchor === null) return;
      const currentEntries = entriesRef.current;
      const lo = Math.min(anchor, currentIndex);
      const hi = Math.max(anchor, currentIndex);
      const paths = new Set(preSelectionRef.current);
      for (let i = lo; i <= hi; i++) {
        paths.add(currentEntries[i].path);
      }
      onDragSelectRef.current(paths);
    },
    []
  );

  /**
   * Native touchmove handler attached with { passive: false } so we can
   * call preventDefault() to suppress scrolling during drag-select.
   * React synthetic touch events are passive in some browsers, making
   * preventDefault() a no-op there.
   *
   * Also attaches a native touchend/touchcancel to reliably clean up,
   * since React's onTouchEnd may not fire if the finger moves off the
   * original element.
   */
  useEffect(() => {
    if (!isMobile) return;

    const handleMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;

      // If we're not yet in drag mode
      if (!dragActiveRef.current) {
        if (!multiSelectModeRef.current) {
          // For long-press: check if moved too much before timer fired
          if (touchStartPosRef.current && longPressTimerRef.current) {
            const dx = touch.clientX - touchStartPosRef.current.x;
            const dy = touch.clientY - touchStartPosRef.current.y;
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
              // Moved too much, cancel long-press
              clearLongPressTimer();
            }
          }
          return;
        }

        // In multi-select mode, check movement threshold to start drag
        if (touchStartPosRef.current) {
          const dx = touch.clientX - touchStartPosRef.current.x;
          const dy = touch.clientY - touchStartPosRef.current.y;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            dragActiveRef.current = true;
            longPressFiredRef.current = true; // Suppress click after drag
          } else {
            return;
          }
        }
      }

      if (!dragActiveRef.current) return;

      // Prevent scrolling while drag-selecting
      e.preventDefault();

      const currentIndex = getEntryIndexAtPoint(touch.clientX, touch.clientY);
      if (currentIndex === null) return;
      if (currentIndex === lastDragIndexRef.current) return; // No change

      lastDragIndexRef.current = currentIndex;
      selectRange(currentIndex);
    };

    const handleEnd = () => {
      clearLongPressTimer();
      dragActiveRef.current = false;
      anchorIndexRef.current = null;
      touchStartPosRef.current = null;
      lastDragIndexRef.current = null;
    };

    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd);
    document.addEventListener("touchcancel", handleEnd);
    return () => {
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
      document.removeEventListener("touchcancel", handleEnd);
    };
  }, [isMobile, clearLongPressTimer, getEntryIndexAtPoint, selectRange]);

  const handleTouchStart = useCallback(
    (entry: FileEntry, entryIndex: number, e: React.TouchEvent) => {
      if (!isMobile) return;

      const touch = e.touches[0];
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      lastDragIndexRef.current = null;
      dragActiveRef.current = false;

      if (multiSelectMode) {
        // In multi-select mode, start drag-select from this item.
        // preSelectionRef is already kept in sync via setPreSelection()
        anchorIndexRef.current = entryIndex;
        longPressFiredRef.current = false;
      } else {
        // Not in multi-select: start long-press timer
        longPressFiredRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          anchorIndexRef.current = entryIndex;
          // Store empty pre-selection since we're just entering multi-select
          preSelectionRef.current = new Set();
          onLongPress(entry);
          // Immediately mark drag as potentially active so touchmove can extend
          dragActiveRef.current = true;
        }, 500);
      }
    },
    [isMobile, multiSelectMode, onLongPress]
  );

  const handleTouchEnd = useCallback(() => {
    clearLongPressTimer();
    dragActiveRef.current = false;
    anchorIndexRef.current = null;
    touchStartPosRef.current = null;
    lastDragIndexRef.current = null;
  }, [clearLongPressTimer]);

  /**
   * Set the pre-existing selection (paths selected before drag starts).
   * Call this when `selectedPaths` changes so drag can merge properly.
   * Ignored while a drag is active to avoid overwriting the snapshot.
   */
  const setPreSelection = useCallback((paths: Set<string>) => {
    if (dragActiveRef.current) return;
    preSelectionRef.current = new Set(paths);
  }, []);

  return {
    handleTouchStart,
    handleTouchEnd,
    longPressFiredRef,
    setPreSelection,
  };
}
