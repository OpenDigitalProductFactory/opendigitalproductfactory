// apps/web/app/(shell)/platform/audit/metrics/page.tsx
import { getToolExecutionMetrics } from "@/lib/tool-execution-data";
import { Notice, StatCard } from "@/components/ui/report-kit";
import { prisma } from "@dpf/db";

import { TopToolsTable } from "./TopToolsTable";

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export default async function OperationalMetricsPage() {
  const [metrics, capCount] = await Promise.all([
    getToolExecutionMetrics(),
    prisma.platformCapability.count(),
  ]);

  const statCards = [
    { label: "Total Executions", value: metrics.totalExecutions, intent: "info" as const },
    { label: "Ledger Events", value: metrics.byAuditClass.ledger, intent: "warning" as const },
    { label: "Journal Events", value: metrics.byAuditClass.journal, intent: "info" as const },
    { label: "Metrics-Only", value: metrics.byAuditClass.metrics_only, intent: "neutral" as const },
    { label: "Success Rate", value: pct(metrics.successRate), intent: "success" as const },
    { label: "Avg Duration", value: metrics.avgDurationMs != null ? `${Math.round(metrics.avgDurationMs)}ms` : "\u2014", intent: "info" as const },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Operational Metrics
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Aggregate counts, success rates, and latency across all tool executions including probe chatter.
        </p>
      </div>

      {capCount === 0 && (
        <Notice variant="warn" title="Capability sync has not run" className="mb-5">
          Audit class data is incomplete until portal initialization or a re-deploy populates capabilities.
        </Notice>
      )}

      <div className="mb-7 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
        {statCards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} intent={card.intent} />
        ))}
      </div>

      {metrics.totalExecutions > 0 && (
        <Notice
          variant={metrics.recentErrorRate > 0.1 ? "error" : "success"}
          title="Recent error rate"
          className="mb-6"
        >
          Last 24 hours: <strong>{pct(metrics.recentErrorRate)}</strong>
        </Notice>
      )}

      {metrics.topTools.length > 0 && (
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
            Top Tools
          </h2>
          <TopToolsTable rows={metrics.topTools} />
        </div>
      )}

      {metrics.totalExecutions === 0 && (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--dpf-muted)", fontSize: 13 }}>
          No tool executions recorded yet. Metrics will appear as agents invoke tools.
        </div>
      )}
    </div>
  );
}
