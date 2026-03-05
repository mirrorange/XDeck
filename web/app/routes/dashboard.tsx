import { useEffect } from "react";

import { AppHeader } from "~/components/app-header";
import { ProcessSummaryCard } from "~/components/dashboard/process-summary-card";
import { SystemDetailSection } from "~/components/dashboard/system-detail-section";
import { SystemInfoBar } from "~/components/dashboard/system-info-bar";
import { TopMetricCards } from "~/components/dashboard/top-metric-cards";
import { getAggregateStatus, useProcessStore } from "~/stores/process-store";
import { useSystemStore } from "~/stores/system-store";

export function meta() {
  return [
    { title: "Dashboard — XDeck" },
    { name: "description", content: "XDeck system dashboard" },
  ];
}

export default function DashboardPage() {
  const { status, fetchStatus, subscribeToMetrics } = useSystemStore();
  const { processes, fetchProcesses } = useProcessStore();

  useEffect(() => {
    fetchStatus();
    fetchProcesses();
  }, [fetchStatus, fetchProcesses]);

  useEffect(() => {
    const unsubscribe = subscribeToMetrics();
    return unsubscribe;
  }, [subscribeToMetrics]);

  const runningCount = processes.filter((p) => getAggregateStatus(p.instances) === "running").length;
  const stoppedCount = processes.filter(
    (p) => {
      const aggregateStatus = getAggregateStatus(p.instances);
      return aggregateStatus === "stopped" || aggregateStatus === "created";
    }
  ).length;
  const errorCount = processes.filter(
    (p) => {
      const aggregateStatus = getAggregateStatus(p.instances);
      return aggregateStatus === "errored" || aggregateStatus === "failed";
    }
  ).length;

  return (
    <>
      <AppHeader title="Dashboard" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <SystemInfoBar status={status} />
          <TopMetricCards status={status} />
          <ProcessSummaryCard
            totalCount={processes.length}
            runningCount={runningCount}
            stoppedCount={stoppedCount}
            errorCount={errorCount}
          />
          <SystemDetailSection status={status} />
        </div>
      </div>
    </>
  );
}
