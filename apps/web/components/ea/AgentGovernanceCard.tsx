import { oversightLabel } from "@/lib/workforce/oversight-copy";

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
  grantCount: number;
  hitlTier: number | null;
  escalatesTo: string | null;
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
  return (
    <div className="rounded-lg bg-[var(--dpf-surface-1)] p-4 border-l-4 border-[var(--dpf-accent)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-mono text-[var(--dpf-muted)]">{agent.agentId}</p>
          <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{agent.name}</p>
        </div>
        <span className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-[var(--dpf-muted)]">
          Tier {agent.tier}
        </span>
      </div>

      {agent.description ? (
        <p className="mt-2 text-[10px] text-[var(--dpf-muted)]">{agent.description}</p>
      ) : null}

      <div className="mt-3 space-y-1.5 text-[10px] text-[var(--dpf-muted)]">
        <p>
          Capability class: <span className="text-[var(--dpf-text)]">{agent.capabilityClassName ?? "Not assigned"}</span>
        </p>
        <p>
          Autonomy: <span className="text-[var(--dpf-text)] capitalize">{formatAutonomyLabel(agent.autonomyLevel)}</span>
        </p>
        <p>
          Owning team: <span className="text-[var(--dpf-text)]">{agent.owningTeamName ?? "Unassigned"}</span>
        </p>
        <p>
          Tool grants: <span className="text-[var(--dpf-text)]">{agent.grantCount} granted</span>
        </p>
        <p>
          Oversight: <span className="text-[var(--dpf-text)]">{oversightLabel(agent.hitlTier)}</span>
        </p>
        {agent.escalatesTo ? (
          <p>
            Escalates to: <span className="text-[var(--dpf-text)]">{agent.escalatesTo}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium text-[var(--dpf-accent)]">
          {agent.portfolioName ?? "Cross-cutting"}
        </p>
        <span className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-medium text-[var(--dpf-text)]">
          {formatCountLabel(agent.activeGrantCount)}
        </span>
      </div>
    </div>
  );
}
