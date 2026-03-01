import { useEffect } from "react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Clock,
  Monitor,
  Network,
} from "lucide-react";

import { AppHeader } from "~/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { useSystemStore } from "~/stores/system-store";
import { useProcessStore } from "~/stores/process-store";
import { formatBytes, formatUptime } from "~/lib/format";

export function meta() {
  return [
    { title: "Dashboard — XDeck" },
    { name: "description", content: "XDeck system dashboard" },
  ];
}

export default function DashboardPage() {
  const { status, fetchStatus } = useSystemStore();
  const { processes, fetchProcesses } = useProcessStore();

  useEffect(() => {
    fetchStatus();
    fetchProcesses();
  }, [fetchStatus, fetchProcesses]);

  const runningCount = processes.filter((p) => p.status === "running").length;
  const stoppedCount = processes.filter(
    (p) => p.status === "stopped" || p.status === "created"
  ).length;
  const errorCount = processes.filter(
    (p) => p.status === "errored" || p.status === "failed"
  ).length;

  return (
    <>
      <AppHeader title="Dashboard" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* System info bar */}
          {status && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Monitor className="size-3.5" />
              <span className="font-medium">{status.hostname}</span>
              <span className="text-border">•</span>
              <span>{status.os_name} {status.os_version}</span>
              <span className="text-border">•</span>
              <Clock className="size-3.5" />
              <span>Uptime: {formatUptime(status.uptime)}</span>
            </div>
          )}

          {/* Top-level metric cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* CPU */}
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

            {/* Memory */}
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

            {/* Disk (primary) */}
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

            {/* Network */}
            <Card className="group relative overflow-hidden transition-shadow hover:shadow-lg">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Network</CardTitle>
                <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
                  <Network className="size-4 text-emerald-500" />
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  const totalRx =
                    status?.network_interfaces?.reduce(
                      (sum, n) => sum + n.rx_bytes,
                      0
                    ) ?? 0;
                  const totalTx =
                    status?.network_interfaces?.reduce(
                      (sum, n) => sum + n.tx_bytes,
                      0
                    ) ?? 0;
                  return (
                    <>
                      <div className="text-2xl font-bold tabular-nums">
                        {status ? formatBytes(totalRx + totalTx) : "—"}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">↓ RX</span>
                          <p className="font-medium tabular-nums">{formatBytes(totalRx)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">↑ TX</span>
                          <p className="font-medium tabular-nums">{formatBytes(totalTx)}</p>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Process summary */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-emerald-500/20 bg-emerald-500/5">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/20">
                  <div className="size-3 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{runningCount}</p>
                  <p className="text-sm text-muted-foreground">Running Processes</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-muted">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <div className="size-3 rounded-full bg-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stoppedCount}</p>
                  <p className="text-sm text-muted-foreground">Stopped Processes</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-destructive/20 bg-destructive/5">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex size-10 items-center justify-center rounded-full bg-destructive/20">
                  <div className="size-3 rounded-full bg-destructive" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{errorCount}</p>
                  <p className="text-sm text-muted-foreground">Errored Processes</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Disk partitions and Load average */}
          {status && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Disk Partitions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Disk Partitions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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
                </CardContent>
              </Card>

              {/* System Load */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">System Load</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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
                  <div className="space-y-3 pt-2">
                    {status.network_interfaces
                      .filter((n) => n.rx_bytes > 0 || n.tx_bytes > 0)
                      .slice(0, 5)
                      .map((iface) => (
                        <div
                          key={iface.name}
                          className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                        >
                          <span className="font-medium">{iface.name}</span>
                          <div className="flex gap-4 text-xs text-muted-foreground tabular-nums">
                            <span>↓ {formatBytes(iface.rx_bytes)}</span>
                            <span>↑ {formatBytes(iface.tx_bytes)}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
