import { DelegationGrantPanel } from "@/components/platform/DelegationGrantPanel";

type GovernanceSummary = {
  teams: number;
  governedAgents: number;
  activeGrants: number;
  pendingApprovals: number;
};

type RecentGrant = {
  grantId: string;
  agentName: string;
  grantorLabel: string;
  status: string;
  expiresAt?: string | null;
  scopeSummary?: string | null;
};

type Props = {
  summary: GovernanceSummary;
  recentGrants: RecentGrant[];
};

const SUMMARY_CARDS: Array<{ key: keyof GovernanceSummary; label: string; accent: string }> = [
  { key: "teams", label: "Teams", accent: "#38bdf8" },
  { key: "governedAgents", label: "Governed agents", accent: "#fb923c" },
  { key: "activeGrants", label: "Active grants", accent: "#4ade80" },
  { key: "pendingApprovals", label: "Pending approvals", accent: "#facc15" },
];

export function GovernanceOverviewPanel({ summary, recentGrants }: Props) {
  return (
    <section className="mb-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Identity governance</h2>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Human accountability, governed agents, and temporary delegation state.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <div
            key={card.key}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
            style={{ borderLeft: `4px solid ${card.accent}` }}
          >
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{summary[card.key]}</p>
          </div>
        ))}
      </div>

      <DelegationGrantPanel grants={recentGrants} />
    </section>
  );
}
