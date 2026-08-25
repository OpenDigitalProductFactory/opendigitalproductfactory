"use client";

// The owner-facing decision surface for one proposed CoworkerActionEnvelope
// (BI-7CB2CCDE).
//
// Deliberately NOT CoworkerProposalActions: that component settles an
// AgentActionProposal through the proposal server actions. An envelope is a
// different record with its own state machine, its own delegating-user rule and
// its own expiry, so it gets its own component and posts only to the
// authenticated envelope endpoints in lib/coworker/envelope-routes.
//
// The block above the buttons is the point of the card. An employee cannot
// honestly approve a commit-bound reviewer action without seeing WHICH coworker,
// WHICH action, on WHICH commit, path and blob, for WHICH gate, and how long the
// window stays open. Approving blind is what the defect forced.

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { AttentionEnvelopeApproval } from "@/lib/attention/types";

type Outcome = "approved" | "declined" | "settled";

export function CoworkerEnvelopeApproval({
  approval,
}: {
  approval: AttentionEnvelopeApproval;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function decide(choice: "approve" | "decline") {
    // One in-flight decision per card. A second press while the first is open
    // would race the state machine into a 409 it never needed to see.
    if (pending || outcome) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        choice === "approve" ? approval.approveHref : approval.declineHref,
        { method: "POST", headers: { "content-type": "application/json" } },
      );
      if (response.ok) {
        setOutcome(choice === "approve" ? "approved" : "declined");
        router.refresh();
        return;
      }
      // 409 means the state machine already settled this envelope — someone
      // else, another tab, or an earlier retry got there first. That is the
      // idempotent outcome, not a failure to report.
      if (response.status === 409) {
        setOutcome("settled");
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That decision could not be saved. Please try again.");
    } catch {
      setError("That decision could not be saved. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Surface padding="sm" rounded="md">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Fact label="Coworker" value={approval.coworkerAgentId} />
          <Fact label="Requested action" value={approval.manifestActionId} />
          <Fact label="Status" value={approval.status} />
          <Fact label="Open until" value={approval.expiresAtIso ?? "No time limit"} />
          {approval.taskRunId ? <Fact label="Task" value={approval.taskRunId} /> : null}
          <Fact label="Reason given" value={approval.rationale} wide />
        </dl>
      </Surface>

      {approval.reviewBinding ? (
        <Surface padding="sm" rounded="md">
          <p className="text-dpf-caption font-semibold uppercase tracking-wider text-[var(--dpf-accent)]">
            Reviewed record
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Fact label="Subject" value={approval.reviewBinding.itemId} />
            <Fact label="Gate" value={approval.reviewBinding.gate} />
            <Fact label="Repository" value={approval.reviewBinding.repositoryFullName} />
            <Fact label="Commit" value={approval.reviewBinding.commitSha} />
            <Fact label="File" value={approval.reviewBinding.path} wide />
            <Fact label="Blob" value={approval.reviewBinding.providerBlobId} wide />
          </dl>
        </Surface>
      ) : null}

      {outcome ? (
        <p className="text-xs font-semibold text-[var(--dpf-text)]" role="status">
          {outcomeMessage(outcome)}
        </p>
      ) : approval.actionable ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => void decide("approve")}>
            Approve action
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void decide("decline")}
          >
            Decline
          </Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--dpf-muted)]">
          This request is closed. Your coworker can ask again.
        </p>
      )}

      {error ? (
        <p className="text-xs text-[var(--dpf-error)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function outcomeMessage(outcome: Outcome): string {
  if (outcome === "approved") return "Action approved.";
  if (outcome === "declined") return "Action declined.";
  return "This request was already settled.";
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-dpf-caption font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-xs text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}
