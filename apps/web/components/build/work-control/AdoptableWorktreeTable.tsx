export type AdoptableWorktreeRow = {
  path: string;
  branch: string | null;
  modifiedCount: number;
  untrackedCount: number;
};

export function AdoptableWorktreeTable({ rows }: { rows: AdoptableWorktreeRow[] }) {
  return (
    <section aria-labelledby="adoptable-work-heading" className="space-y-3">
      <h2 id="adoptable-work-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        Adoptable work
      </h2>
      {rows.length === 0 ? (
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          No adoptable local work detected.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--dpf-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--dpf-surface-2)] text-left text-xs text-[var(--dpf-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Path</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Changed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              {rows.map((row) => (
                <tr key={`${row.path}:${row.branch ?? "detached"}`}>
                  <td className="px-3 py-2 align-top font-mono text-xs text-[var(--dpf-text)]">{row.path}</td>
                  <td className="px-3 py-2 align-top font-mono text-xs text-[var(--dpf-muted)]">{row.branch ?? "detached"}</td>
                  <td className="px-3 py-2 align-top text-[var(--dpf-text)]">{row.modifiedCount + row.untrackedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
