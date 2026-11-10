"use client";

// A pending approval request on the supervisor agent card (BI-7BCC87BB;
// founder decision DI-FFD78D222548, envelope-shared-buttons). It is decided
// with the same Authorize / Decline as the Needs-you card and the chat card,
// posted to the envelope routes, which check again who may decide:
//   - the person whose authority it lends gets the two buttons;
//   - an admin who is not that person gets "Decide on their behalf" with a
//     required reason (plan B8, AC-OVERRIDE);
//   - anyone else sees who it is waiting for, and no control.

import { useRouter } from "next/navigation";
import { useState } from "react";

import { EnvelopeDecisionButtons } from "@/components/attention/EnvelopeDecisionButtons";
import { OnBehalfDecision, decidedOnBehalfText } from "@/components/attention/OnBehalfDecision";
import type { SupervisorPendingEnvelope } from "@/lib/tak/agent-card-types";
import { SOURCE_CATALOG } from "@dpf/i18n";
import { DEFAULT_LOCALE, formatSource } from "@dpf/i18n/runtime";

const COPY = SOURCE_CATALOG.approvals.agentCard;

type Outcome = { tone: "done" | "problem"; text: string; note?: string };

export type AgentCardViewer = { userId: string; isAdmin: boolean };

export function AgentCardEnvelopeDecision({
  envelope,
  viewer,
}: {
  envelope: SupervisorPendingEnvelope;
  viewer?: AgentCardViewer;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const isOwner = viewer?.userId === envelope.delegatingUserId;
  const canOverride = !isOwner && viewer?.isAdmin === true;

  async function decide(choice: "approve" | "decline", onBehalfReason?: string) {
    if (pending || outcome) return;
    setPending(true);
    try {
      const response = await fetch(choice === "approve" ? envelope.approveHref : envelope.declineHref, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(onBehalfReason !== undefined ? { body: JSON.stringify({ onBehalf: true, reason: onBehalfReason }) } : {}),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        execution?: { status?: string; message?: string };
        onBehalf?: { by: string; onBehalfOf: string; reason: string };
      } | null;
      if (!response.ok) {
        setOutcome({ tone: "problem", text: body?.error ?? COPY.notSaved });
        return;
      }
      const note = body?.onBehalf ? decidedOnBehalfText(body.onBehalf) : undefined;
      const text = choice === "decline"
        ? COPY.declined
        : body?.execution?.status === "executed"
          ? COPY.done
          : `${COPY.authorized} ${body?.execution?.message ?? ""}`.trim();
      setOutcome({ tone: choice === "approve" && body?.execution?.status !== "executed" ? "problem" : "done", text, ...(note ? { note } : {}) });
      router.refresh();
    } catch {
      setOutcome({ tone: "problem", text: COPY.notSaved });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-1 space-y-2">
      <p className="text-xs text-[var(--dpf-text)]">
        <span className="font-semibold">{envelope.actionLabel}</span>
        <span className="text-[var(--dpf-muted)]"> · {envelope.rationale}</span>
      </p>
      {outcome ? (
        <div role="status" className="space-y-1">
          <p className={`text-xs ${outcome.tone === "done" ? "text-[var(--dpf-success)]" : "text-[var(--dpf-error)]"}`}>
            {outcome.text}
          </p>
          {outcome.note ? <p className="text-xs text-[var(--dpf-muted)]">{outcome.note}</p> : null}
        </div>
      ) : isOwner ? (
        <EnvelopeDecisionButtons
          pending={pending}
          onAuthorize={() => void decide("approve")}
          onDecline={() => void decide("decline")}
        />
      ) : canOverride ? (
        <OnBehalfDecision
          ownerLabel={envelope.ownerLabel}
          pending={pending}
          onDecide={(choice, reason) => void decide(choice, reason)}
        />
      ) : (
        <p className="text-xs text-[var(--dpf-muted)]">
          {formatSource(DEFAULT_LOCALE, COPY.waitingFor, { owner: envelope.ownerLabel })}
        </p>
      )}
    </div>
  );
}
