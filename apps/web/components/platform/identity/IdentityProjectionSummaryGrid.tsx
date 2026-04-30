import { type AgentIdentitySnapshotSummary } from "@/lib/identity/agent-identity-snapshot";

const SUMMARY_CARDS: Array<{
  key: keyof AgentIdentitySnapshotSummary;
  label: string;
  accent: string;
}> = [
  { key: "projectedAgents", label: "Projected AIDocs", accent: "var(--dpf-accent)" },
  { key: "validatedAgents", label: "Validated now", accent: "var(--dpf-success)" },
  { key: "unlinkedAgents", label: "Still unlinked", accent: "var(--dpf-warning)" },
  {
    key: "portableAuthorizationClassCount",
    label: "Portable authorization classes",
    accent: "var(--dpf-info)",
  },
];

export function IdentityProjectionSummaryGrid({
  summary,
}: {
  summary: AgentIdentitySnapshotSummary;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {SUMMARY_CARDS.map((card) => (
        <article
          key={card.key}
          className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
          style={{ boxShadow: `inset 0 1px 0 color-mix(in srgb, ${card.accent} 18%, transparent)` }}
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            {card.label}
          </p>
          <p className="mt-3 text-3xl font-semibold text-[var(--dpf-text)]">{summary[card.key]}</p>
          <div
            className="mt-3 h-1.5 rounded-full bg-[var(--dpf-surface-2)]"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${summary.totalAgents === 0 ? 0 : Math.min(100, Math.max(10, Math.round((Number(summary[card.key]) / summary.totalAgents) * 100)))}%`,
                background: card.accent,
              }}
            />
          </div>
        </article>
      ))}
    </div>
  );
}
