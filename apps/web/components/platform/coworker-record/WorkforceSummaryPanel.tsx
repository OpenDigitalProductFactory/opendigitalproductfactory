// apps/web/components/platform/coworker-record/WorkforceSummaryPanel.tsx
// EP-COWORKER-RT (coworker-management-consolidation, WS5) — the founder's
// "see this detail summarized" panel at the top of /platform/ai. Presentational:
// it renders a WorkforceSummary (computed by lib/coworker-record/workforce-summary)
// as report-kit StatCards plus compact role-type / family mix chips. Theme tokens
// only — StatCard already flows through the intent → --dpf-* model.

import { StatCard } from "@/components/ui/report-kit";
import type { WorkforceSummary } from "@/lib/coworker-record/workforce-summary";

export function WorkforceSummaryPanel({ summary }: { summary: WorkforceSummary }) {
  if (summary.total === 0) return null;

  const { health, naming } = summary;
  // The naming-health card should read green when the workforce is clean (WS1
  // done) and warn only when something still carries a bad/empty displayName.
  const namingClean = naming.needsAttention === 0;

  return (
    <section style={{ marginBottom: 18 }}>
      <h2
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--dpf-muted)",
          marginBottom: 10,
        }}
      >
        Workforce summary
      </h2>

      {/* KPI tiles — report-kit StatCard (pure, token-backed). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <StatCard
          label="Coworkers"
          value={summary.total}
          hint={`${summary.byKind.length} role type${summary.byKind.length === 1 ? "" : "s"} · ${summary.familiesRepresented} famil${summary.familiesRepresented === 1 ? "y" : "ies"}`}
          intent="accent"
        />
        <StatCard
          label="Conversation readiness"
          value={`${health.conversationReady}/${summary.total}`}
          hint={health.conversationUnavailable > 0 ? `${health.conversationUnavailable} cannot start advertised work` : "every coworker can start advertised work"}
          intent={health.conversationUnavailable > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Open blockers"
          value={health.openBlockersTotal}
          hint={
            health.withOpenBlockers > 0
              ? `across ${health.withOpenBlockers} coworker${health.withOpenBlockers === 1 ? "" : "s"}`
              : "no open capability blockers"
          }
          intent={health.openBlockersTotal > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Unmapped roles"
          value={health.unmappedRole}
          hint={health.unmappedRole > 0 ? "no profession family bound" : "every role maps to a family"}
          intent={health.unmappedRole > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Naming health"
          value={namingClean ? "clean" : naming.needsAttention}
          hint={
            namingClean
              ? "every coworker has a clean name"
              : `${naming.missingDisplayName} missing · ${naming.suffixInName} with a name suffix`
          }
          intent={namingClean ? "success" : "warning"}
        />
      </div>

      {/* Role-type & family mix — compact chip rows (the at-a-glance distribution). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        <MixRow label="By role type" buckets={summary.byKind} />
        <MixRow label="By family" buckets={summary.byFamily.slice(0, 6)} extra={summary.byFamily.length > 6 ? summary.byFamily.length - 6 : 0} />
      </div>
    </section>
  );
}

function MixRow({
  label,
  buckets,
  extra = 0,
}: {
  label: string;
  buckets: { key: string; label: string; count: number }[];
  /** How many additional buckets were truncated (shown as "+N more"). */
  extra?: number;
}) {
  if (buckets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 200 }}>
      <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dpf-muted)" }}>
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {buckets.map((b) => (
          <span
            key={b.key}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid var(--dpf-border)",
              color: "var(--dpf-text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            {b.label} <span style={{ color: "var(--dpf-muted)", fontWeight: 600 }}>{b.count}</span>
          </span>
        ))}
        {extra > 0 && (
          <span style={{ fontSize: 10, padding: "2px 8px", color: "var(--dpf-muted)" }}>+{extra} more</span>
        )}
      </div>
    </div>
  );
}
