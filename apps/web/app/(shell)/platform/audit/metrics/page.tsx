// apps/web/app/(shell)/platform/audit/metrics/page.tsx
import { getToolExecutionMetrics } from "@/lib/tool-execution-data";
import { prisma } from "@dpf/db";

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export default async function OperationalMetricsPage() {
  const [metrics, capCount] = await Promise.all([
    getToolExecutionMetrics(),
    prisma.platformCapability.count(),
  ]);

  const statCards = [
    { label: "Total Executions",    value: metrics.totalExecutions,             accent: "#7c8cf8" },
    { label: "Ledger Events",        value: metrics.byAuditClass.ledger,         accent: "#f59e0b" },
    { label: "Journal Events",       value: metrics.byAuditClass.journal,        accent: "#60a5fa" },
    { label: "Metrics-Only",         value: metrics.byAuditClass.metrics_only,   accent: "#a78bfa" },
    { label: "Success Rate",         value: pct(metrics.successRate),            accent: "#4ade80" },
    { label: "Avg Duration",         value: metrics.avgDurationMs != null ? `${Math.round(metrics.avgDurationMs)}ms` : "\u2014", accent: "#38bdf8" },
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
        <div style={{
          background: "#1a1a2e",
          border: "1px solid #f59e0b",
          borderRadius: 6,
          padding: "10px 14px",
          marginBottom: 20,
          fontSize: 12,
          color: "#f59e0b",
        }}>
          <strong>Phase 2 not yet run:</strong> The PlatformCapability table is empty. Audit class data will be incomplete until capability sync runs.
          Run the portal-init container or trigger a re-deploy to populate it.
        </div>
      )}

      {/* Stat cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
        gap: 8,
        marginBottom: 28,
      }}>
        {statCards.map((card) => (
          <div
            key={card.label}
            style={{
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderLeft: `3px solid ${card.accent}`,
              borderRadius: 6,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {card.label}
            </div>
            <div style={{ fontSize: typeof card.value === "string" && card.value.length > 6 ? 16 : 22, fontWeight: 600, color: "var(--dpf-text)", marginTop: 4 }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent error rate */}
      {metrics.totalExecutions > 0 && (
        <div style={{
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          borderLeft: `3px solid ${metrics.recentErrorRate > 0.1 ? "#ef4444" : "#4ade80"}`,
          borderRadius: 6,
          padding: "10px 14px",
          marginBottom: 24,
          fontSize: 12,
        }}>
          <span style={{ color: "var(--dpf-muted)" }}>Recent error rate (last 24h): </span>
          <strong style={{ color: metrics.recentErrorRate > 0.1 ? "#ef4444" : "var(--dpf-text)" }}>
            {pct(metrics.recentErrorRate)}
          </strong>
        </div>
      )}

      {/* Top tools table */}
      {metrics.topTools.length > 0 && (
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
            Top Tools
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {/* Header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "2fr 80px 90px",
              gap: 8,
              padding: "8px 12px",
              fontSize: 10, fontWeight: 600, color: "var(--dpf-muted)",
              textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              <span>Tool</span>
              <span>Executions</span>
              <span>Success Rate</span>
            </div>

            {metrics.topTools.map((t) => (
              <div
                key={t.toolName}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 80px 90px",
                  gap: 8,
                  padding: "10px 12px",
                  background: "#1a1a2e",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--dpf-text)",
                  alignItems: "center",
                }}
              >
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>{t.toolName}</span>
                <span>{t.count}</span>
                <span>
                  <span style={{
                    color: t.successRate >= 0.9 ? "#4ade80" : t.successRate >= 0.7 ? "#f59e0b" : "#ef4444",
                  }}>
                    {pct(t.successRate)}
                  </span>
                </span>
              </div>
            ))}
          </div>
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
