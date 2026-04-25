import Link from "next/link";

import type { AuthorityBindingPivot, AuthorityBindingRow } from "@/lib/authority/bindings";

type BindingListProps = {
  pivot: AuthorityBindingPivot;
  rows: AuthorityBindingRow[];
  emptyMessage: string;
  detailHrefBase?: string;
  detailQueryBase?: string;
};

function pivotHeading(pivot: AuthorityBindingPivot) {
  return pivot === "subject" ? "Subject" : "Coworker";
}

export function BindingList({ pivot, rows, emptyMessage, detailHrefBase, detailQueryBase }: BindingListProps) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]"
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <table className="w-full border-collapse text-left text-sm text-[var(--dpf-text)]">
        <thead className="bg-[var(--dpf-surface-2)] text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
          <tr>
            <th className="px-4 py-3 font-medium">{pivotHeading(pivot)}</th>
            <th className="px-4 py-3 font-medium">Resource</th>
            <th className="px-4 py-3 font-medium">Applied coworker</th>
            <th className="px-4 py-3 font-medium">Approval</th>
            <th className="px-4 py-3 font-medium">Subjects</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.bindingId}:${row.pivotLabel}`} className="border-t border-[var(--dpf-border)]">
              <td className="px-4 py-3">
                <div className="font-medium text-[var(--dpf-text)]">
                  {detailHrefBase ? (
                    <Link href={`${detailHrefBase}/${row.bindingId}`} className="text-[var(--dpf-accent)] hover:underline">
                      {row.pivotLabel}
                    </Link>
                  ) : detailQueryBase ? (
                    <Link href={`${detailQueryBase}?binding=${row.bindingId}`} className="text-[var(--dpf-accent)] hover:underline">
                      {row.pivotLabel}
                    </Link>
                  ) : (
                    row.pivotLabel
                  )}
                </div>
                <div className="text-xs text-[var(--dpf-muted)]">{row.bindingId}</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-[var(--dpf-text)]">{row.resourceRef}</div>
                <div className="text-xs text-[var(--dpf-muted)]">
                  {row.resourceType} · {row.scopeType}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-[var(--dpf-text)]">{row.appliedAgentName ?? "Unassigned"}</div>
                <div className="text-xs text-[var(--dpf-muted)]">{row.appliedAgentId ?? "No coworker set"}</div>
              </td>
              <td className="px-4 py-3 text-[var(--dpf-text)]">{row.approvalMode}</td>
              <td className="px-4 py-3">
                <div className="text-[var(--dpf-text)]">{row.subjectLabels.join(", ") || "None"}</div>
                <div className="text-xs text-[var(--dpf-muted)]">{row.subjectCount} subject(s)</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
