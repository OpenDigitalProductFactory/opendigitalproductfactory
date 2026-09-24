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

/** What the approve endpoint reports about running the approved request. */
type Execution = { status: "executed" | "failed" | "not-run"; message: string };

export function CoworkerEnvelopeApproval({
  approval,
}: {
  approval: AttentionEnvelopeApproval;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
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
        const body = (await response.json().catch(() => null)) as { execution?: Execution } | null;
        if (body?.execution) setExecution(body.execution);
        setOutcome(choice === "approve" ? "authorized" : "declined");
        router.refresh();
        return;
      }
      // 409 means the state machine already settled this envelope — someone
      // else, another tab, or an earlier retry got there first. That is the
      // idempotent outcome, not a failure to report.
      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (body?.error && /expired/i.test(body.error)) {
          setExecution({ status: "not-run", message: body.error });
        }
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
          <Fact label="Action" value={decision.action} wide />
          <Fact label="Where it lands" value={decision.target} wide />
          {decision.subjectId ? <Fact label="Subject" value={decision.subjectId} /> : null}
          {decision.gate ? <Fact label="Gate" value={decision.gate} /> : null}
          {decision.decision ? <Fact label="Decision" value={decision.decision} /> : null}
          {decision.kind === "known" ? (
            <Fact
              label="Findings"
              value={
                decision.findings.length === 0
                  ? "None"
                  : decision.findings.map((finding) => finding.issue).join(" ")
              }
              wide
            />
          ) : null}
          {decision.reason ? <Fact label="Reason" value={decision.reason} wide /> : null}
          <Fact label="Consequence" value={decision.consequence} wide />
          <Fact label="Why you are asked" value={decision.whyAPerson} wide />
          <Fact label="What authorizing covers" value={decision.scope} wide />
          <Fact label="Status" value={statusLabel(approval)} />
          <Fact label="Recommender" value={decision.recommenderLabel} />
          <Fact label="Accountable authorizer" value={decision.authorizerLabel} />
        </dl>
        {decision.kind === "known" ? null : decision.kind === "exact" ? (
          <div className="mt-3">
            <p className="text-dpf-caption font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">
              Proposed content
            </p>
            <dl className="mt-1 grid gap-y-1.5">
              {decision.proposed.map((field, index) => (
                <Fact key={`${field.label}-${index}`} label={field.label} value={field.value} wide />
              ))}
            </dl>
          </div>
        ) : (
          <p className="mt-3 text-xs font-semibold text-[var(--dpf-text)]" role="note">
            {decision.recordedIfAuthorized}
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-[var(--dpf-muted)]">
          {decision.authorizeDoes} {decision.declineDoes}
        </p>
      </Surface>

      {outcome ? (
        <p className="text-xs font-semibold text-[var(--dpf-text)]" role="status">
          {outcomeMessage(outcome, execution)}
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

function outcomeMessage(outcome: Outcome, execution: Execution | null): string {
  // Say what actually happened to the change, never "done" while nothing ran.
  if (outcome === "authorized") {
    if (execution?.status === "executed") return "Authorized and done.";
    if (execution?.status === "failed") return `Authorized, but it did not complete: ${execution.message}`;
    return `Authorized. Nothing has been written yet. ${execution?.message ?? ""}`.trim();
  }
  if (outcome === "declined") return "Declined. Nothing was changed.";
  return execution?.message ?? "This request was already settled.";
}

function statusLabel(approval: AttentionEnvelopeApproval): string {
  if (approval.status === "proposed") {
    return approval.actionable ? "Waiting for your decision" : "Closed: the window expired";
  }
  if (approval.status === "approved") return "Authorized, not yet run";
  if (approval.status === "executed") return "Authorized and run";
  if (approval.status === "declined") return "Declined";
  if (approval.status === "expired") return "Closed: the window expired";
  return approval.status;
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
