import { Clock, Monitor } from "lucide-react";

import { formatUptime } from "~/lib/format";
import type { SystemStatus } from "~/stores/system-store";

export function SystemInfoBar({ status }: { status: SystemStatus | null }) {
  if (!status) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Monitor className="size-3.5" />
      <span className="font-medium">{status.hostname}</span>
      <span className="text-border">•</span>
      <span>{status.os_name} {status.os_version}</span>
      <span className="text-border">•</span>
      <Clock className="size-3.5" />
      <span>Uptime: {formatUptime(status.uptime)}</span>
    </div>
  );
}
