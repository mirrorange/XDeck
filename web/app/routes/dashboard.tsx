import { useEffect } from "react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Clock,
  Monitor,
  Network,
  ArrowDown,
  ArrowUp,
  Activity,
  Play,
  Square,
  AlertTriangle,
} from "lucide-react";

import { AppHeader } from "~/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useSystemStore } from "~/stores/system-store";
import { useProcessStore } from "~/stores/process-store";
import { formatBytes, formatUptime, formatSpeed } from "~/lib/format";

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
  const totalCount = processes.length;

  // Compute aggregate network speeds
  const totalRxSpeed =
    status?.network_interfaces?.reduce((sum, n) => sum + n.rx_speed, 0) ?? 0;
  const totalTxSpeed =
    status?.network_interfaces?.reduce((sum, n) => sum + n.tx_speed, 0) ?? 0;

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

            {/* Network — now shows real-time speed */}
            <Card className="group relative overflow-hidden transition-shadow hover:shadow-lg">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Network</CardTitle>
                <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
                  <Network className="size-4 text-emerald-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {status ? formatSpeed(totalRxSpeed + totalTxSpeed) : "—"}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <ArrowDown className="size-3 text-emerald-500" />
                    <span className="text-muted-foreground">RX</span>
                    <span className="ml-auto font-medium tabular-nums">{formatSpeed(totalRxSpeed)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUp className="size-3 text-emerald-500" />
                    <span className="text-muted-foreground">TX</span>
                    <span className="ml-auto font-medium tabular-nums">{formatSpeed(totalTxSpeed)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Process summary — merged into one card */}
          <Card className="group relative overflow-hidden transition-shadow hover:shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-500/3 to-slate-400/3 opacity-0 transition-opacity group-hover:opacity-100" />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">Process Guardian</CardTitle>
              <div className="flex size-8 items-center justify-center rounded-lg bg-slate-500/10">
                <Activity className="size-4 text-slate-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                {/* Total */}
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                    <Activity className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums">{totalCount}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                </div>
                {/* Running */}
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10">
                    <Play className="size-4 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-emerald-500">{runningCount}</p>
                    <p className="text-xs text-muted-foreground">Running</p>
                  </div>
                </div>
                {/* Stopped */}
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                    <Square className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums">{stoppedCount}</p>
                    <p className="text-xs text-muted-foreground">Stopped</p>
                  </div>
                </div>
                {/* Errored */}
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
                    <AlertTriangle className="size-4 text-destructive" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-destructive">{errorCount}</p>
                    <p className="text-xs text-muted-foreground">Errored</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Detail cards */}
          {status && (
            <div className="space-y-4">
              {/* Row 1: Compact cards — Disk I/O + System Load */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Disk I/O */}
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

                {/* System Load */}
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

              {/* Row 2: Variable-height cards — Disk Partitions + Network Interfaces */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Disk Partitions */}
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

                {/* Network Interfaces */}
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
          )}
        </div>
      </div>
    </>
  );
}
