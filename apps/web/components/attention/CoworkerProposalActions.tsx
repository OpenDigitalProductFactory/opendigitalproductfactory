"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { approveProposal, rejectProposal } from "@/lib/actions/proposals";
import { ProposalNoLongerRunnable } from "@/components/agent/ProposalNoLongerRunnable";

export function CoworkerProposalActions({
  proposalId,
  noLongerRunnable: persistedRefusal,
}: {
  proposalId: string;
  /** A refusal already persisted on the row (after a reload). */
  noLongerRunnable?: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<"approved" | "declined" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Approval convergence PR-C (BI-04E5A511, spec D5): the reference monitor
  // refused the proposed call. Nothing ran and the proposal is still pending,
  // so only Decline is offered.
  const [noLongerRunnable, setNoLongerRunnable] = useState<string | null>(persistedRefusal ?? null);
  const [pending, startTransition] = useTransition();

  if (result) {
    return (
      <p className="text-xs font-semibold text-[var(--dpf-text)]" role="status">
        {result === "approved" ? "Action approved." : "Action declined."}
      </p>
    );
  }

  const decide = (decision: "approve" | "decline") => {
    setError(null);
    startTransition(async () => {
      const response =
        decision === "approve"
          ? await approveProposal(proposalId)
          : await rejectProposal(proposalId, "Owner declined this action");
      if (response.success) {
        setResult(decision === "approve" ? "approved" : "declined");
        // The card acknowledged, but the header kept reading "40 things need you
        // today" until a manual reload, so the rational next move was to press
        // again (BI-79E207B9). Re-render the server tree so the count follows
        // the decision.
        router.refresh();
        return;
      }
      if ("noLongerRunnable" in response && response.noLongerRunnable) {
        setNoLongerRunnable(response.error ?? "It was refused.");
        return;
      }
      setError(response.error ?? "That decision could not be saved. Please try again.");
    });
  };

  return (
    <div className="space-y-2">
      {noLongerRunnable ? <ProposalNoLongerRunnable reason={noLongerRunnable} /> : null}
      <div className="flex flex-wrap gap-2">
        {noLongerRunnable ? null : (
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("approve")}
          className="min-h-9 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          Approve action
        </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("decline")}
          className="min-h-9 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          Decline
        </button>
      </div>
      {error ? (
        <p className="text-xs text-[var(--dpf-error)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
