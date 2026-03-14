import { PORTFOLIO_COLOURS } from "@/lib/portfolio";

type AgentGovernanceCardModel = {
  id: string;
  agentId: string;
  name: string;
  description: string | null;
  tier: number;
  portfolioName: string | null;
  portfolioSlug: string | null;
  capabilityClassName: string | null;
  autonomyLevel: string | null;
  owningTeamName: string | null;
  activeGrantCount: number;
};

type Props = {
  agent: AgentGovernanceCardModel;
};

function formatCountLabel(count: number): string {
  return `${count} active grant${count === 1 ? "" : "s"}`;
}

function formatAutonomyLabel(autonomyLevel: string | null): string {
  return autonomyLevel ? autonomyLevel.replaceAll("_", " ") : "governance pending";
}

export function AgentGovernanceCard({ agent }: Props) {
  const colour = agent.portfolioSlug
    ? (PORTFOLIO_COLOURS[agent.portfolioSlug] ?? "#555566")
    : "#555566";

  return (
    <div
      className="rounded-lg bg-[var(--dpf-surface-1)] p-4"
      style={{ borderLeft: `4px solid ${colour}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-mono text-[var(--dpf-muted)]">{agent.agentId}</p>
          <p className="mt-1 text-sm font-semibold text-white">{agent.name}</p>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-[var(--dpf-muted)]">
          Tier {agent.tier}
        </span>
      </div>

      {agent.description ? (
        <p className="mt-2 text-[10px] text-[var(--dpf-muted)]">{agent.description}</p>
      ) : null}

      <div className="mt-3 space-y-1.5 text-[10px] text-[var(--dpf-muted)]">
        <p>
          Capability class: <span className="text-white">{agent.capabilityClassName ?? "Not assigned"}</span>
        </p>
        <p>
          Autonomy: <span className="text-white capitalize">{formatAutonomyLabel(agent.autonomyLevel)}</span>
        </p>
        <p>
          Owning team: <span className="text-white">{agent.owningTeamName ?? "Unassigned"}</span>
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium" style={{ color: colour }}>
          {agent.portfolioName ?? "Cross-cutting"}
        </p>
        <span className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-medium text-white">
          {formatCountLabel(agent.activeGrantCount)}
        </span>
      </div>
    </div>
  );
}
