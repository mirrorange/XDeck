import { ArrowDown, ArrowUp, Network } from "lucide-react";

import { formatBytes, formatSpeed } from "~/lib/format";
import type { SystemStatus } from "~/stores/system-store";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { ScrollArea } from "~/components/ui/scroll-area";

export function SystemDetailSection({ status }: { status: SystemStatus | null }) {
  if (!status) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Disk I/O</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ArrowDown className="size-4 text-amber-500" />
                  <span>Read</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {formatSpeed(status.disk_read_speed)}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ArrowUp className="size-4 text-amber-500" />
                  <span>Write</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {formatSpeed(status.disk_write_speed)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Load</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {["1 min", "5 min", "15 min"].map((label, i) => (
                <div key={label} className="text-center">
                  <p className="text-2xl font-bold tabular-nums">
                    {status.load_average[i].toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-base">Disk Partitions</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ScrollArea className="h-64 pr-3 pb-6">
              <div className="space-y-4">
                {status.disk_partitions.map((disk, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate max-w-[200px]">
                        {disk.mount_point}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatBytes(disk.used)} / {formatBytes(disk.total)}
                      </span>
                    </div>
                    <Progress
                      value={disk.usage_percent}
                      className={`h-2 ${
                        disk.usage_percent > 90
                          ? "[&>div]:bg-destructive"
                          : disk.usage_percent > 70
                          ? "[&>div]:bg-amber-500"
                          : "[&>div]:bg-emerald-500"
                      }`}
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{disk.fs_type}</span>
                      <span>{disk.usage_percent.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-base">Network Interfaces</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ScrollArea className="h-64 pr-3 pb-6">
              <div className="space-y-3">
                {status.network_interfaces
                  .filter((n) => n.rx_bytes > 0 || n.tx_bytes > 0)
                  .sort((a, b) => (b.rx_bytes + b.tx_bytes) - (a.rx_bytes + a.tx_bytes))
                  .map((iface) => (
                    <div
                      key={iface.name}
                      className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Network className="size-3.5 text-emerald-500" />
                        <span className="font-medium">{iface.name}</span>
                      </div>
                      <div className="flex gap-4 text-xs tabular-nums">
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <ArrowDown className="size-3" />
                          {formatSpeed(iface.rx_speed)}
                        </span>
                        <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                          <ArrowUp className="size-3" />
                          {formatSpeed(iface.tx_speed)}
                        </span>
                        <span className="text-muted-foreground">
                          Σ {formatBytes(iface.rx_bytes + iface.tx_bytes)}
                        </span>
                      </div>
                    </div>
                  ))}
                {status.network_interfaces.filter(
                  (n) => n.rx_bytes > 0 || n.tx_bytes > 0
                ).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No active network interfaces
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
