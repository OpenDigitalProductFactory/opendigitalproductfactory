type AgentIdentityRow = {
  id: string;
  agentId: string;
  name: string;
  status: string;
  lifecycleStage: string;
  humanSupervisorId: string | null;
  linkedPrincipalId: string | null;
};

export function AgentIdentityPanel({ agents }: { agents: AgentIdentityRow[] }) {
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Agent Identity</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Track which AI coworkers are already anchored to the principal spine and which still need linking or richer GAID/TAK identity projection.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <div className="grid grid-cols-[1.1fr_0.8fr_0.8fr_1fr] gap-4 border-b border-[var(--dpf-border)] px-5 py-3 text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
          <span>Agent</span>
          <span>Status</span>
          <span>Lifecycle</span>
          <span>Identity Coverage</span>
        </div>
        {agents.map((agent) => {
          const linked = Boolean(agent.linkedPrincipalId);
          return (
            <div
              key={agent.id}
              className="grid grid-cols-[1.1fr_0.8fr_0.8fr_1fr] gap-4 border-b border-[var(--dpf-border)] px-5 py-4 last:border-b-0"
            >
              <div>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{agent.name}</p>
                <p className="mt-1 text-[11px] font-mono text-[var(--dpf-muted)]">{agent.agentId}</p>
                {agent.humanSupervisorId ? (
                  <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">Supervisor: {agent.humanSupervisorId}</p>
                ) : null}
              </div>
              <div className="text-sm text-[var(--dpf-text)]">{agent.status}</div>
              <div className="text-sm text-[var(--dpf-text)]">{agent.lifecycleStage}</div>
              <div>
                <span
                  className={[
                    "rounded-full px-2 py-1 text-[11px] font-medium",
                    linked
                      ? "border border-[var(--dpf-success)] bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]"
                      : "border border-[var(--dpf-warning)] bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]",
                  ].join(" ")}
                >
                  {linked ? "principal linked" : "needs linking"}
                </span>
                {agent.linkedPrincipalId ? (
                  <p className="mt-2 text-[11px] font-mono text-[var(--dpf-muted)]">{agent.linkedPrincipalId}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
