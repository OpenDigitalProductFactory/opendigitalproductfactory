import {
  type AgentIdentitySnapshot,
  type AgentIdentitySnapshotSummary,
} from "@/lib/identity/agent-identity-snapshot";

import { IdentityProjectionSummaryGrid } from "./IdentityProjectionSummaryGrid";

function formatValidationLabel(state: AgentIdentitySnapshot["validationState"]) {
  switch (state) {
    case "validated":
      return "validated";
    case "pending-revalidation":
      return "pending revalidation";
    case "stale":
      return "stale";
    default:
      return "unlinked";
  }
}

function getValidationClasses(state: AgentIdentitySnapshot["validationState"]) {
  switch (state) {
    case "validated":
      return "border-[var(--dpf-success)] bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]";
    case "pending-revalidation":
      return "border-[var(--dpf-info)] bg-[var(--dpf-info)]/10 text-[var(--dpf-info)]";
    case "stale":
      return "border-[var(--dpf-warning)] bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]";
    default:
      return "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]";
  }
}

export function AgentIdentityPanel({
  agents,
  summary,
}: {
  agents: AgentIdentitySnapshot[];
  summary: AgentIdentitySnapshotSummary;
}) {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Agent Identity</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Track which AI coworkers are already anchored to the principal spine, which now resolve into a shared AIDoc projection, and which still need identity coverage before they can participate cleanly in TAK/GAID trust surfaces.
        </p>
      </div>

      <IdentityProjectionSummaryGrid summary={summary} />

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {agents.map((agent) => (
          <article
            key={agent.id}
            className="rounded-3xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                  {agent.agentId}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{agent.name}</h2>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[var(--dpf-text)]">
                    {agent.status}
                  </span>
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[var(--dpf-text)]">
                    {agent.lifecycleStage}
                  </span>
                  {agent.humanSupervisorId ? (
                    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[var(--dpf-text)]">
                      Supervisor {agent.humanSupervisorId}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col items-start gap-2">
                <span
                  className={[
                    "rounded-full border px-2 py-1 text-[11px] font-medium",
                    getValidationClasses(agent.validationState),
                  ].join(" ")}
                >
                  {formatValidationLabel(agent.validationState)}
                </span>
                <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-muted)]">
                  {agent.linkedPrincipalId ? "principal linked" : "needs linking"}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                  Identity chain
                </p>
                <div className="mt-3 space-y-2 text-sm">
                  <p className="font-mono text-[var(--dpf-text)]">
                    {agent.linkedPrincipalId ?? "No principal linked yet"}
                  </p>
                  <p className="font-mono text-[var(--dpf-muted)]">
                    {agent.gaid ?? "No GAID alias projected yet"}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                  Operating profile
                </p>
                <div className="mt-3 space-y-2 text-sm">
                  <p className="font-mono break-all text-[var(--dpf-text)]">
                    {agent.operatingProfileFingerprint ?? "Not projected"}
                  </p>
                  <p className="text-[var(--dpf-muted)]">
                    {agent.toolSurfaceCount} tools in surface · {agent.promptClassRefCount} prompt classes
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                Portable authorization classes
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {agent.authorizationClasses.length > 0 ? (
                  agent.authorizationClasses.map((authClass) => (
                    <span
                      key={`${agent.agentId}-${authClass}`}
                      className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                    >
                      {authClass}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-muted)]">
                    No portable classes projected yet
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
