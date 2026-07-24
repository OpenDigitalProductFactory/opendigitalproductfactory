"use client";

// The rule-on-this affordance for a weight-adjustment proposal (BI-D88DFEEA).
// Mirrors GapAnswerForm's open/closed disclosure, but the evidence is already
// structured (axis, direction, consistency, sample size) so this shows that
// evidence and offers Accept/Reject instead of a free-text capture box.

import { useState, useTransition } from "react";

import { ruleWeightProposal } from "./actions";

export function WeightProposalForm({ proposalId }: { proposalId: string }) {
  const [open, setOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <p className="mt-2 ml-1 text-xs text-[var(--dpf-success)]">
        ✓ {result.message}
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-2 ml-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          Rule on this →
        </button>
      </div>
    );
  }

  const submit = (ruling: "accept" | "reject") => {
    if (pending) return;
    startTransition(async () => {
      const res = await ruleWeightProposal({
        proposalId,
        ruling,
        rejectionReason: ruling === "reject" ? rejectionReason.trim() || undefined : undefined,
      });
      setResult(res);
    });
  };

  return (
    <div className="mt-2 ml-1 flex flex-col gap-2">
      <p className="text-xs text-[var(--dpf-muted)]">
        Accepting records this at the ruled tier — it does not yet change any
        live decision score. Rejecting means this org's overrides here look
        like inconsistency or fatigue, not a real preference.
      </p>
      {showRejectReason && (
        <textarea
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
          rows={2}
          autoFocus
          placeholder="Why reject this (optional)…"
          className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
        />
      )}
      {result && !result.ok && (
        <p className="text-xs text-[var(--dpf-error)]">{result.message}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => submit("accept")}
          disabled={pending}
          className="rounded-md border border-[var(--dpf-accent)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
        >
          {pending ? "Recording…" : "Accept"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!showRejectReason) {
              setShowRejectReason(true);
              return;
            }
            submit("reject");
          }}
          disabled={pending}
          className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
        >
          {pending ? "Recording…" : "Reject"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setShowRejectReason(false);
            setRejectionReason("");
            setResult(null);
          }}
          disabled={pending}
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
