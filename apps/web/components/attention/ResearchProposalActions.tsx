"use client";

import { useState, useTransition } from "react";

import {
  approveResearchProposalAction,
  declineResearchProposalAction,
} from "@/lib/actions/research-proposals";

export function ResearchProposalActions({ proposalId }: { proposalId: string }) {
  const [result, setResult] = useState<"approved" | "skipped" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (result) {
    return (
      <p className="text-xs font-semibold text-[var(--dpf-text)]" role="status">
        {result === "approved"
          ? "Research approved. It will run in the background and return as a draft."
          : "Research skipped."}
      </p>
    );
  }

  const decide = (decision: "approve" | "decline") => {
    setError(null);
    startTransition(async () => {
      const response =
        decision === "approve"
          ? await approveResearchProposalAction(proposalId)
          : await declineResearchProposalAction(proposalId);
      if (response.ok) {
        setResult(decision === "approve" ? "approved" : "skipped");
        return;
      }
      setError(response.error ?? "That decision could not be saved. Please try again.");
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("approve")}
          className="min-h-9 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          Approve research
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("decline")}
          className="min-h-9 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          Skip this
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
