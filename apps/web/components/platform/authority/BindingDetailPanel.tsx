type BindingDetailPanelProps = {
  binding: {
    bindingId: string;
    name: string;
    scopeType: string;
    status: string;
    resourceType: string;
    resourceRef: string;
    approvalMode: string;
    sensitivityCeiling: string | null;
    appliedAgent: {
      agentId: string;
      name: string;
      governanceProfile: {
        capabilityClass?: { name: string } | null;
        directivePolicyClass?: { name: string } | null;
      } | null;
      toolGrants: Array<{ grantKey: string }>;
    } | null;
    subjects: Array<{
      id: string;
      subjectType: string;
      subjectRef: string;
      relation: string;
    }>;
    grants: Array<{
      id: string;
      grantKey: string;
      mode: string;
      rationale: string | null;
    }>;
  };
  evidence: Array<{
    id: string;
    decisionId: string;
    decision: string;
    actionKey: string;
    routeContext: string | null;
    createdAt: Date;
  }>;
};

function sectionCard(title: string, children: ReactNode) {
  return (
    <section className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function BindingDetailPanel({ binding, evidence }: BindingDetailPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">{binding.bindingId}</div>
            <h1 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{binding.name}</h1>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              {binding.resourceType} {binding.resourceRef} · {binding.scopeType} · {binding.status}
            </p>
          </div>
          <div className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs text-[var(--dpf-text)]">
            {binding.approvalMode}
          </div>
        </div>
      </div>

      {sectionCard(
        "Summary",
        <dl className="grid gap-3 text-sm text-[var(--dpf-text)] md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Resource</dt>
            <dd>{binding.resourceRef}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Sensitivity ceiling</dt>
            <dd>{binding.sensitivityCeiling ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Applied coworker</dt>
            <dd>{binding.appliedAgent?.name ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Tool grants</dt>
            <dd>{binding.appliedAgent?.toolGrants.map((grant) => grant.grantKey).join(", ") || "None"}</dd>
          </div>
        </dl>,
      )}

      {sectionCard(
        "Subjects",
        <ul className="space-y-2 text-sm text-[var(--dpf-text)]">
          {binding.subjects.length === 0 ? (
            <li className="text-[var(--dpf-muted)]">No subjects configured.</li>
          ) : (
            binding.subjects.map((subject) => (
              <li key={subject.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
                <span className="font-medium">{subject.subjectRef}</span>
                <span className="ml-2 text-[var(--dpf-muted)]">
                  {subject.subjectType} · {subject.relation}
                </span>
              </li>
            ))
          )}
        </ul>,
      )}

      {sectionCard(
        "Coworker application",
        <div className="space-y-3 text-sm text-[var(--dpf-text)]">
          <div>
            <div className="font-medium">{binding.appliedAgent?.name ?? "No coworker assigned"}</div>
            {binding.appliedAgent ? (
              <div className="text-[var(--dpf-muted)]">
                {binding.appliedAgent.agentId}
                {binding.appliedAgent.governanceProfile?.capabilityClass?.name
                  ? ` · ${binding.appliedAgent.governanceProfile.capabilityClass.name}`
                  : ""}
                {binding.appliedAgent.governanceProfile?.directivePolicyClass?.name
                  ? ` · ${binding.appliedAgent.governanceProfile.directivePolicyClass.name}`
                  : ""}
              </div>
            ) : null}
          </div>
          <ul className="space-y-2">
            {binding.grants.length === 0 ? (
              <li className="text-[var(--dpf-muted)]">No contextual grant narrowing configured.</li>
            ) : (
              binding.grants.map((grant) => (
                <li key={grant.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
                  <span className="font-medium">{grant.grantKey}</span>
                  <span className="ml-2 text-[var(--dpf-muted)]">{grant.mode}</span>
                  {grant.rationale ? <div className="mt-1 text-xs text-[var(--dpf-muted)]">{grant.rationale}</div> : null}
                </li>
              ))
            )}
          </ul>
        </div>,
      )}

      {sectionCard(
        "Evidence",
        <ul className="space-y-2 text-sm text-[var(--dpf-text)]">
          {evidence.length === 0 ? (
            <li className="text-[var(--dpf-muted)]">No authorization evidence linked yet.</li>
          ) : (
            evidence.map((item) => (
              <li key={item.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
                <div className="font-medium">{item.decisionId}</div>
                <div className="text-[var(--dpf-muted)]">
                  {item.actionKey} · {item.decision}
                  {item.routeContext ? ` · ${item.routeContext}` : ""}
                </div>
              </li>
            ))
          )}
        </ul>,
      )}
    </div>
  );
}
import type { ReactNode } from "react";
