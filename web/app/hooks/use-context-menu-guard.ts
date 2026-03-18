import { useCallback, useRef } from "react";

type GuardedPointerType = "mouse" | "touch" | "pen";

export function useContextMenuGuard() {
  const lastPointerTypeRef = useRef<GuardedPointerType | null>(null);
  const lastPointerTimeRef = useRef(0);

  const rememberPointerType = useCallback((pointerType: string | null | undefined) => {
    if (pointerType !== "mouse" && pointerType !== "touch" && pointerType !== "pen") {
      return;
    }

    lastPointerTypeRef.current = pointerType;
    lastPointerTimeRef.current = performance.now();
  }, []);

  const shouldSuppressContextMenu = useCallback(() => {
    const pointerType = lastPointerTypeRef.current;
    if (pointerType !== "touch" && pointerType !== "pen") {
      return false;
    }

    return performance.now() - lastPointerTimeRef.current < 1500;
  }, []);

  return {
    rememberPointerType,
    shouldSuppressContextMenu,
  };
}
