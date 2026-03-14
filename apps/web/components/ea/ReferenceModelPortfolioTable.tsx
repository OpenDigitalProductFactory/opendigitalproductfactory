import type { ReferenceModelPortfolioRollupRow } from "@/lib/reference-model-types";

type Props = {
  rows: ReferenceModelPortfolioRollupRow[];
};

const STATUS_ORDER = [
  "implemented",
  "partial",
  "planned",
  "not_started",
  "out_of_mvp",
] as const;

export function ReferenceModelPortfolioTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm text-[var(--dpf-muted)]">
          No portfolio assessments have been recorded for this model yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <table className="min-w-full divide-y divide-[var(--dpf-border)] text-sm">
        <thead className="bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Portfolio</th>
            {STATUS_ORDER.map((status) => (
              <th key={status} className="px-3 py-2 text-left font-medium">
                {status}
              </th>
            ))}
            <th className="px-3 py-2 text-left font-medium">MVP Included</th>
            <th className="px-3 py-2 text-left font-medium">Out of MVP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--dpf-border)] text-white">
          {rows.map((row) => (
            <tr key={row.scopeRef}>
              <td className="px-3 py-2 font-medium">{row.scopeName}</td>
              {STATUS_ORDER.map((status) => (
                <td key={status} className="px-3 py-2">
                  {row.counts[status]}
                </td>
              ))}
              <td className="px-3 py-2">{row.mvpIncludedCount}</td>
              <td className="px-3 py-2">{row.outOfMvpCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
