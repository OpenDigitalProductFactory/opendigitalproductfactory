"use client";

import { useState, useTransition } from "react";

import { approveProposal, rejectProposal } from "@/lib/actions/proposals";

export function ProactivityProposalActions({ proposalId }: { proposalId: string }) {
  const [result, setResult] = useState<"accepted" | "kept" | "narrowed" | null>(null);
  const [pending, startTransition] = useTransition();

  if (result) {
    return (
      <p className="text-xs font-semibold text-[var(--dpf-text)]" role="status">
        {result === "accepted"
          ? "Boundary accepted. Money and public actions still come to you."
          : result === "narrowed"
            ? "Narrowing requested. Your coworker will return with a smaller boundary."
            : "Current level kept. Your coworker will wait before suggesting this again."}
      </p>
    );
  }

  const decide = (decision: "approve" | "reject" | "narrow") => {
    startTransition(async () => {
      const response =
        decision === "approve"
          ? await approveProposal(proposalId)
          : await rejectProposal(
              proposalId,
              decision === "narrow"
                ? "Please narrow the operating boundary before asking again"
                : "Keep the current proactivity level",
            );
      if (response.success) {
        setResult(decision === "approve" ? "accepted" : decision === "narrow" ? "narrowed" : "kept");
      }
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("approve")}
        className="min-h-9 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
      >
        Accept boundary
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("reject")}
        className="min-h-9 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
      >
        Keep current level
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("narrow")}
        className="min-h-9 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
      >
        Narrow boundary
      </button>
    </div>
  );
}
