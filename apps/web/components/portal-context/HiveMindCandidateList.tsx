import type { HiveMindCandidate } from "@/lib/portal-context";

export function HiveMindCandidateList({ candidates }: { candidates: HiveMindCandidate[] }) {
  if (candidates.length === 0) {
    return <p className="text-sm text-[var(--dpf-muted)]">No recommended coworkers</p>;
  }

  return (
    <ul className="grid gap-2">
      {candidates.map((candidate) => (
        <li key={`${candidate.agentId}:${candidate.role}`} className="border-b border-[var(--dpf-border)] pb-2 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--dpf-text)]">{candidate.label}</span>
            <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-xs text-[var(--dpf-muted)]">
              {candidate.role}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">{candidate.reason}</p>
        </li>
      ))}
    </ul>
  );
}
