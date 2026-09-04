"use client";

// The owner-facing decision surface for one proposed CoworkerActionEnvelope
// (BI-7CB2CCDE, decision-first copy BI-F95B0795).
//
// Deliberately NOT CoworkerProposalActions: that component settles an
// AgentActionProposal through the proposal server actions. An envelope is a
// different record with its own state machine, its own delegating-user rule and
// its own expiry, so it gets its own component and posts only to the
// authenticated envelope endpoints in lib/coworker/envelope-routes.
//
// The primary block is the proposed decision and the human authorization to
// record it. Identity plumbing lives under Technical detail.

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { AttentionEnvelopeApproval } from "@/lib/attention/types";

type Outcome = "authorized" | "declined" | "settled";

export function CoworkerEnvelopeApproval({
  approval,
}: {
  approval: AttentionEnvelopeApproval;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const decision = approval.decision;

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
        setOutcome(choice === "approve" ? "authorized" : "declined");
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
        <p className="text-dpf-caption font-semibold uppercase tracking-wider text-[var(--dpf-accent)]">
          Human authorization needed
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-text)]">
          {decision.authorization}.
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {decision.subjectId ? <Fact label="Subject" value={decision.subjectId} /> : null}
          {decision.gate ? <Fact label="Gate" value={decision.gate} /> : null}
          {decision.decision ? <Fact label="Decision" value={decision.decision} /> : null}
          <Fact
            label="Findings"
            value={
              decision.findings.length === 0
                ? "None"
                : decision.findings.map((finding) => finding.issue).join(" ")
            }
            wide
          />
          {decision.reason ? <Fact label="Reason" value={decision.reason} wide /> : null}
          <Fact label="Recommender" value={decision.recommenderLabel} />
          <Fact label="Accountable authorizer" value={decision.authorizerLabel} />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-[var(--dpf-muted)]">
          {decision.authorizeDoes} {decision.declineDoes}
        </p>
      </Surface>

      {outcome ? (
        <p className="text-xs font-semibold text-[var(--dpf-text)]" role="status">
          {outcomeMessage(outcome)}
        </p>
      ) : approval.actionable ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => void decide("approve")}>
            Authorize
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
  if (outcome === "authorized") return "Record authorized.";
  if (outcome === "declined") return "Record declined.";
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
