import { Activity, AlertTriangle, Play, Square } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export function ProcessSummaryCard({
  totalCount,
  runningCount,
  stoppedCount,
  errorCount,
}: {
  totalCount: number;
  runningCount: number;
  stoppedCount: number;
  errorCount: number;
}) {
  return (
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
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <Activity className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{totalCount}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10">
              <Play className="size-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-emerald-500">{runningCount}</p>
              <p className="text-xs text-muted-foreground">Running</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <Square className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{stoppedCount}</p>
              <p className="text-xs text-muted-foreground">Stopped</p>
            </div>
          </div>
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
  );
}
