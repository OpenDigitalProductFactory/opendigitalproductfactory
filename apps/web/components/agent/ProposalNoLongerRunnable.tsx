// Approval convergence PR-C (BI-04E5A511, spec D5): a legacy proposal whose
// approval the reference monitor refused. Nothing ran and the proposal is
// still pending, so the card says why and hides Approve; the card's existing
// decline action stays.

type ProposalCardState = {
  status: string;
  resultEntityId?: string;
  resultError?: string;
  noLongerRunnable?: string;
};

type ApprovalResult = {
  success: boolean;
  resultEntityId?: string;
  error?: string;
  noLongerRunnable?: true;
};

/** The card's state after Approve: a monitor refusal keeps it pending, with the reason. */
export function proposalAfterApproval<T extends ProposalCardState>(proposal: T, result: ApprovalResult): T {
  if (result.noLongerRunnable) return { ...proposal, noLongerRunnable: result.error ?? "It was refused." };
  return {
    ...proposal,
    status: result.success ? "executed" : "failed",
    ...(result.resultEntityId !== undefined ? { resultEntityId: result.resultEntityId } : {}),
    ...(result.error !== undefined ? { resultError: result.error } : {}),
  };
}

export function ProposalNoLongerRunnable({ reason }: { reason: string }) {
  return (
    <p role="status" className="m-0 mb-2 text-xs leading-normal text-[var(--dpf-text)]">
      This request can no longer run as proposed: {reason}
    </p>
  );
}
