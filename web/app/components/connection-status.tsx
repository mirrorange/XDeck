import { useEffect, useState } from "react";
import { getRpcClient } from "~/lib/rpc-client";
import type { ConnectionState } from "~/lib/ws-client";
import { cn } from "~/lib/utils";

const stateConfig: Record<
  ConnectionState,
  { color: string; label: string }
> = {
  connected: { color: "bg-emerald-500", label: "Connected" },
  connecting: { color: "bg-amber-500", label: "Connecting…" },
  disconnected: { color: "bg-destructive", label: "Disconnected" },
};

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>("disconnected");

  useEffect(() => {
    const rpc = getRpcClient();
    setState(rpc.state);
    const unsub = rpc.onConnectionChange((s) => setState(s));
    return unsub;
  }, []);

  const config = stateConfig[state];

  // Only show when not connected (to not clutter UI)
  if (state === "connected") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border bg-background/95 backdrop-blur px-3 py-2 text-sm shadow-lg">
      <span
        className={cn(
          "size-2 rounded-full",
          config.color,
          state === "connecting" && "animate-pulse"
        )}
      />
      <span className="text-muted-foreground">{config.label}</span>
    </div>
  );
}
