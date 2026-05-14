export type WorkCapsuleRow = {
  capsuleId: string;
  title: string;
  status: string;
  source: string;
  executorKind: string;
  branch: string;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  health: string;
  updatedAt: string;
};

export function WorkCapsuleTable({ capsules }: { capsules: WorkCapsuleRow[] }) {
  return (
    <section aria-labelledby="work-capsules-heading" className="space-y-3">
      <h2 id="work-capsules-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        Active capsules
      </h2>
      {capsules.length === 0 ? (
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          No active capsules yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--dpf-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--dpf-surface-2)] text-left text-xs text-[var(--dpf-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Capsule</th>
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
