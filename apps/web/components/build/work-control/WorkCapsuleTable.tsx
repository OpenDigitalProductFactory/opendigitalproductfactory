export type WorkCapsuleRow = {
  capsuleId: string;
  title: string;
  status: string;
  source: string;
  executorKind: string;
  branch: string;
  scope?: {
    decisionScope: string | null;
    decisionScopeLabel: string | null;
    portfolioRole: string | null;
    portfolioRoleLabel: string | null;
    servedPersona: string | null;
    activityKind: string | null;
    activityKindLabel: string | null;
    outcomeAnchorLabel: string | null;
    servesPortfolioRoleLabels: string[];
    dependsOnPortfolioRoleLabels: string[];
  };
  worktreePath: string | null;
  pullRequestUrl: string | null;
  health: string;
  updatedAt: string;
};

function ScopeBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex max-w-48 items-center truncate rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-xs text-[var(--dpf-muted)]">
      {children}
    </span>
  );
}

function CapsuleScopeBadges({ capsule }: { capsule: WorkCapsuleRow }) {
  const labels = [
    capsule.scope?.decisionScopeLabel,
    capsule.scope?.portfolioRoleLabel,
    capsule.scope?.servedPersona,
    capsule.scope?.activityKindLabel,
    capsule.scope?.outcomeAnchorLabel,
  ].filter((label): label is string => Boolean(label));

  if (labels.length === 0) return null;
  return (
    <div className="mt-1 flex max-w-md flex-wrap gap-1">
      {labels.map((label) => (
        <ScopeBadge key={label}>{label}</ScopeBadge>
      ))}
    </div>
  );
}

export function WorkCapsuleTable({ capsules }: { capsules: WorkCapsuleRow[] }) {
  return (
    <section aria-labelledby="work-capsules-heading" className="space-y-3">
      <h2 id="work-capsules-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        Live Workrooms
      </h2>
      {capsules.length === 0 ? (
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          No live Workrooms.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--dpf-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--dpf-surface-2)] text-left text-xs text-[var(--dpf-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Workroom</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Executor</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Health</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              {capsules.map((capsule) => (
                <tr key={capsule.capsuleId}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-[var(--dpf-text)]">{capsule.title}</div>
                    <CapsuleScopeBadges capsule={capsule} />
                    <div className="font-mono text-xs text-[var(--dpf-muted)]">{capsule.capsuleId}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-[var(--dpf-text)]">{capsule.status}</td>
                  <td className="px-3 py-2 align-top text-[var(--dpf-text)]">{capsule.executorKind}</td>
                  <td className="px-3 py-2 align-top font-mono text-xs text-[var(--dpf-muted)]">{capsule.branch}</td>
                  <td className="px-3 py-2 align-top text-[var(--dpf-text)]">{capsule.health}</td>
                  <td className="px-3 py-2 align-top font-mono text-xs text-[var(--dpf-muted)]">{capsule.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
