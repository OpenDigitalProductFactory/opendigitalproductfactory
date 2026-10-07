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
import { envelopeInboxRoute, envelopeResultRoute, envelopeStatusRoute } from "@/lib/coworker/envelope-routes";
import { SOURCE_CATALOG } from "@dpf/i18n";

const COPY = SOURCE_CATALOG.approvals.card;
const EXPIRED = SOURCE_CATALOG.approvals.expiredUnanswered;

type Outcome = "authorized" | "declined" | "settled";

/** How long a decision may stay unanswered before the card checks what was saved. */
const DECISION_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 10_000;

/** The recorded outcome the status route returns (approval-outcome projection). */
type RecordedOutcome = { state: string; label: string; nextAction: string; inboxHref: string };

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
  const [recorded, setRecorded] = useState<RecordedOutcome | null>(null);
  const [reraised, setReraised] = useState(false);
  // The decision may or may not have been saved, and the card cannot tell.
  const [unknown, setUnknown] = useState(false);
  const decision = approval.decision;

  // BI-F4EB23C1: a decision that never answered is reconciled against what the
  // server recorded. The card never sends the decision again on its own.
  async function reconcile() {
    try {
      const response = await fetch(envelopeStatusRoute(approval.envelopeId), {
        method: "GET", signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      const body = response.ok ? (await response.json().catch(() => null)) as { outcome?: RecordedOutcome } | null : null;
      const saved = body?.outcome;
      if (!saved) throw new Error("status unavailable");
      if (saved.state === "waiting") {
        setError(COPY.notReached);
        return;
      }
      setRecorded(saved);
      setOutcome("settled");
      router.refresh();
    } catch {
      setUnknown(true);
    }
  }

  async function decide(choice: "approve" | "decline") {
    // One in-flight decision per card. A second press while the first is open
    // would race the state machine into a 409 it never needed to see.
    if (pending || outcome || unknown) return;
    setPending(true);
    setError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DECISION_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(
          choice === "approve" ? approval.approveHref : approval.declineHref,
          { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal },
        );
      } catch {
        // No answer, or the connection dropped: the decision may have been
        // saved. Find out instead of claiming either way.
        await reconcile();
        return;
      }
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { execution?: Execution; outcomeWarning?: string } | null;
        if (body?.execution) setExecution(body.execution);
        setOutcome(choice === "approve" ? "authorized" : "declined");
        if (body?.outcomeWarning) {
          setError(body.outcomeWarning);
          return;
        }
        router.replace(envelopeResultRoute(approval.envelopeId));
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
        router.replace(envelopeResultRoute(approval.envelopeId));
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That decision could not be saved. Please try again.");
    } finally {
      clearTimeout(timer);
      setPending(false);
    }
  }

  // BI-0012E6CA: put a request nobody answered back in front of this person.
  // The server re-checks the delegate, the lapse and the stored binding; the
  // coworker's call still runs through the full authority gate if approved.
  async function askAgain() {
    if (pending || reraised || !approval.reraiseHref) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(approval.reraiseHref, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
      });
      // Refusals use the canonical API error body ({ code, message }).
      const body = (await response.json().catch(() => null)) as { envelope?: { id?: string }; message?: string } | null;
      if (!response.ok || !body?.envelope?.id) {
        setError(body?.message ?? EXPIRED.askFailed);
        return;
      }
      setReraised(true);
      router.replace(envelopeInboxRoute(body.envelope.id));
      router.refresh();
    } catch {
      setError(EXPIRED.askFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Surface padding="sm" rounded="md">
        {decision.kind === "handover" && decision.handover ? (
          <HandoverDecision approval={approval} decision={decision} handover={decision.handover} />
        ) : (
        <section>
        <p className="text-dpf-caption font-semibold uppercase tracking-wider text-[var(--dpf-accent)]">
          {COPY.authorizationNeeded}
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
        <Effects decision={decision} />
        </section>
        )}
      </Surface>

      {approval.expiredUnanswered ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--dpf-text)]" role="note">
            {reraised ? EXPIRED.asked : EXPIRED.explanation}
          </p>
          {reraised ? null : (
            <Button size="sm" variant="secondary" disabled={pending || !approval.reraiseHref} onClick={() => void askAgain()}>
              {pending ? EXPIRED.asking : EXPIRED.askAgain}
            </Button>
          )}
        </div>
      ) : outcome ? (
        <p className="text-xs font-semibold text-[var(--dpf-text)]" role="status">
          {recorded ? `${recorded.label}. ${recorded.nextAction}` : outcomeMessage(outcome, execution)}
        </p>
      ) : unknown ? (
        <div role="alert" className="space-y-1 text-xs text-[var(--dpf-error)]">
          <p>{COPY.unknownResult}</p>
          <a className="font-semibold text-[var(--dpf-accent)] hover:opacity-80" href={envelopeResultRoute(approval.envelopeId)}>
            {COPY.unknownLink}
          </a>
        </div>
      ) : approval.actionable ? (
        <>
        {pending ? (
          <p className="text-xs text-[var(--dpf-muted)]" role="status">
            {COPY.saving}
          </p>
        ) : null}
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
        </>
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
  if (approval.expiredUnanswered) return EXPIRED.label;
  if (approval.status === "proposed") {
    return approval.actionable ? "Waiting for your decision" : "Closed: the window expired";
  }
  if (approval.status === "approved") return "Authorized, not yet run";
  if (approval.status === "executed") return "Authorized and run";
  if (approval.status === "declined") return "Declined";
  if (approval.status === "expired") return "Closed: the window expired";
  return approval.status;
}

function Effects({ decision }: { decision: AttentionEnvelopeApproval["decision"] }) {
  return (
    <dl className="mt-3 grid gap-y-2">
      <Fact label={COPY.ifAuthorize} value={decision.authorizeDoes} wide />
      <Fact label={COPY.ifDecline} value={decision.declineDoes} wide />
    </dl>
  );
}

/**
 * A room handover in plain words: who takes over which room, what changes and
 * what does not. The exact call stays one click away for anyone who needs it,
 * and it is still the exact call that runs (BI-F4EB23C1).
 */
function HandoverDecision({ approval, decision, handover }: {
  approval: AttentionEnvelopeApproval;
  decision: AttentionEnvelopeApproval["decision"];
  handover: NonNullable<AttentionEnvelopeApproval["decision"]["handover"]>;
}) {
  return (
    <>
      <section>
        <p className="text-dpf-caption font-semibold uppercase tracking-wider text-[var(--dpf-accent)]">
          {COPY.authorizationNeeded}
        </p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{decision.headline}</h3>
        <p className="mt-2 text-dpf-caption font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">{COPY.whatChanges}</p>
        <ul className="mt-1 list-disc space-y-1 ps-4 text-xs leading-relaxed text-[var(--dpf-text)]">
          {handover.changes.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="mt-2 text-dpf-caption font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">{COPY.whatStays}</p>
        <ul className="mt-1 list-disc space-y-1 ps-4 text-xs leading-relaxed text-[var(--dpf-text)]">
          {handover.keeps.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {handover.nextStep ? (
          <p className="mt-2 text-xs text-[var(--dpf-text)]">{COPY.nextStep}: {handover.nextStep}</p>
        ) : null}
        <Effects decision={decision} />
        <dl className="mt-3 grid gap-y-2">
          <Fact label={COPY.status} value={statusLabel(approval)} />
        </dl>
      </section>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--dpf-muted)]">{COPY.technical}</summary>
        <dl className="mt-2 grid gap-y-1.5">
          <Fact label={COPY.tool} value={decision.toolName} wide />
          <Fact label={COPY.request} value={approval.envelopeId} wide />
          <Fact label={COPY.assistant} value={approval.coworkerAgentId} wide />
          <Fact label={COPY.whyAsked} value={decision.whyAPerson} wide />
          <Fact label={COPY.covers} value={decision.scope} wide />
          {decision.proposed.map((field, index) => (
            <Fact key={`${field.label}-${index}`} label={field.label} value={field.value} wide />
          ))}
        </dl>
      </details>
    </>
  );
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
