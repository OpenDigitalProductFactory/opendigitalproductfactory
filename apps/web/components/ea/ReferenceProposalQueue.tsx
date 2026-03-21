import type { ReferenceModelDetail } from "@/lib/reference-model-types";

type Props = {
  proposals: ReferenceModelDetail["proposals"];
};

export function ReferenceProposalQueue({ proposals }: Props) {
  if (proposals.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm text-[var(--dpf-muted)]">
          No proposals are waiting for review.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Proposal Queue</h3>
        <p className="text-xs text-[var(--dpf-muted)]">
          AI and human-proposed reference-model changes awaiting review.
        </p>
      </div>
      <div className="space-y-2">
        {proposals.map((proposal) => (
          <div
            key={proposal.id}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--dpf-text)]">{proposal.proposalType}</p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--dpf-muted)]">
                {proposal.status}
              </p>
            </div>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Proposed by {proposal.proposedByType}
            </p>
            {proposal.reviewNotes && (
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">{proposal.reviewNotes}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
