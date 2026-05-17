import type { EvidenceSummary } from "@/lib/portal-context";

export function EvidenceSummaryList({ evidence }: { evidence: EvidenceSummary[] }) {
  if (evidence.length === 0) {
    return <p className="text-sm text-[var(--dpf-muted)]">No evidence recorded</p>;
  }

  return (
    <ul className="grid gap-2">
      {evidence.map((item) => (
        <li key={`${item.source}:${item.recordId}`} className="border-b border-[var(--dpf-border)] pb-2 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--dpf-text)]">{item.label}</span>
            <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-xs text-[var(--dpf-muted)]">
              {item.source}
            </span>
          </div>
          <div className="mt-1 text-xs text-[var(--dpf-muted)]">{item.recordedAt}</div>
        </li>
      ))}
    </ul>
  );
}
