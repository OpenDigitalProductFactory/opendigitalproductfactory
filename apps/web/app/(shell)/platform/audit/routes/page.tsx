// apps/web/app/(shell)/platform/audit/routes/page.tsx
import { RouteDecisionLogClient } from "@/components/platform/RouteDecisionLogClient";
import {
  getRouteDecisionLogs,
  getRouteDecisionStats,
} from "@/lib/actions/route-decision-logs";

const STAT_CARDS: Array<{
  key: keyof Awaited<ReturnType<typeof getRouteDecisionStats>>;
  label: string;
  accent: string;
  format?: (v: number) => string;
}> = [
  { key: "total",            label: "Total Decisions",  accent: "#7c8cf8" },
  { key: "uniqueTaskTypes",  label: "Task Types",       accent: "#38bdf8" },
  { key: "uniqueModels",     label: "Models Used",      accent: "#4ade80" },
  { key: "avgFitnessScore",  label: "Avg Fitness",      accent: "#facc15", format: (v) => `${(v * 100).toFixed(0)}%` },
];

export default async function AuditRoutesPage() {
  const [rows, stats] = await Promise.all([
    getRouteDecisionLogs(200),
    getRouteDecisionStats(),
  ]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Route Decision Log
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Every routing decision logged with full audit trail — which model was selected, why, and what was excluded.
        </p>
      </div>

      {/* Stats */}
      {stats.total > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
          gap: 8,
          marginBottom: 24,
        }}>
          {STAT_CARDS.map((card) => (
            <div
              key={card.key}
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
              <div style={{ fontSize: 22, fontWeight: 600, color: "var(--dpf-text)", marginTop: 4 }}>
                {card.format ? card.format(stats[card.key]) : stats[card.key]}
              </div>
            </div>
          ))}
        </div>
      )}

      <RouteDecisionLogClient rows={rows} />
    </div>
  );
}
