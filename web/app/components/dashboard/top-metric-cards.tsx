import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
} from "lucide-react";

import { formatBytes, formatSpeed } from "~/lib/format";
import type { SystemStatus } from "~/stores/system-store";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";

export function TopMetricCards({ status }: { status: SystemStatus | null }) {
  const totalRxSpeed =
    status?.network_interfaces?.reduce((sum, n) => sum + n.rx_speed, 0) ?? 0;
  const totalTxSpeed =
    status?.network_interfaces?.reduce((sum, n) => sum + n.tx_speed, 0) ?? 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="group relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">CPU Usage</CardTitle>
          <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10">
            <Cpu className="size-4 text-blue-500" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tabular-nums">
            {status ? `${status.cpu_usage.toFixed(1)}%` : "—"}
          </div>
          <Progress
            value={status?.cpu_usage ?? 0}
            className="mt-3 h-1.5 [&>div]:bg-blue-500"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {status ? `${status.cpu_cores} cores` : ""}
            {status ? ` • Load: ${status.load_average[0].toFixed(2)}` : ""}
          </p>
        </CardContent>
      </Card>

      <Card className="group relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-purple-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Memory</CardTitle>
          <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/10">
            <MemoryStick className="size-4 text-violet-500" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tabular-nums">
            {status ? `${status.memory_usage_percent.toFixed(1)}%` : "—"}
          </div>
          <Progress
            value={status?.memory_usage_percent ?? 0}
            className="mt-3 h-1.5 [&>div]:bg-violet-500"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {status
              ? `${formatBytes(status.memory_used)} / ${formatBytes(status.memory_total)}`
              : ""}
          </p>
        </CardContent>
      </Card>

      <Card className="group relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-orange-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Disk</CardTitle>
          <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10">
            <HardDrive className="size-4 text-amber-500" />
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const disk = status?.disk_partitions?.[0];
            return (
              <>
                <div className="text-2xl font-bold tabular-nums">
                  {disk ? `${disk.usage_percent.toFixed(1)}%` : "—"}
                </div>
                <Progress
                  value={disk?.usage_percent ?? 0}
                  className="mt-3 h-1.5 [&>div]:bg-amber-500"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {disk
                    ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}`
                    : ""}
                </p>
              </>
            );
          })()}
        </CardContent>
      </Card>

      <Card className="group relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Network</CardTitle>
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
            <Network className="size-4 text-emerald-500" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowDown className="size-3.5 text-emerald-500" />
                <span>Download</span>
              </div>
              <p className="text-xl font-bold tabular-nums">
                {status ? formatSpeed(totalRxSpeed) : "—"}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowUp className="size-3.5 text-emerald-500" />
                <span>Upload</span>
              </div>
              <p className="text-xl font-bold tabular-nums">
                {status ? formatSpeed(totalTxSpeed) : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
