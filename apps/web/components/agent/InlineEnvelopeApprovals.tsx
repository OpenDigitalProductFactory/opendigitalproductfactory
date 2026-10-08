"use client";

// The approval requests a coworker's chat turn raised, shown on the message
// that raised them (BI-C8EC05C9, spec D2 S1). Each is a CoworkerActionEnvelope,
// decided with the same Authorize / Decline surface as its Needs-you card and
// posted to the same envelope endpoints, which check that the person deciding
// is the one whose authority is lent. The same requests also appear in
// Needs-you; this list never replaces that card.

import { useState } from "react";

import { EnvelopeDecisionButtons } from "@/components/attention/EnvelopeDecisionButtons";
import type { InlineApprovalRequest } from "@/lib/agent-coworker-types";
import { envelopeApproveRoute, envelopeDeclineRoute, envelopeInboxRoute } from "@/lib/coworker/envelope-routes";
import { SOURCE_CATALOG } from "@dpf/i18n";

const APPROVALS = SOURCE_CATALOG.approvals;

function stateLabel(status: string): string {
  const states = APPROVALS.states as Record<string, { label: string } | undefined>;
  return states[status]?.label ?? status;
}

type Outcome = { tone: "done" | "problem"; text: string };

/** What the approve endpoint reports about running the approved request. */
type Execution = { status: string; message?: string };

function readable(toolName: string): string {
  return toolName.replace(/_/g, " ");
}

export function InlineEnvelopeApprovals({ requests }: { requests: InlineApprovalRequest[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "85%", marginTop: 4 }}>
      {requests.map((request) => (
        <InlineEnvelopeApproval key={request.envelopeId} request={request} />
      ))}
    </div>
  );
}

function InlineEnvelopeApproval({ request }: { request: InlineApprovalRequest }) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const open = request.status === "proposed" && !outcome;

  async function decide(choice: "approve" | "decline") {
    if (pending || outcome) return;
    setPending(true);
    try {
      const response = await fetch(
        choice === "approve" ? envelopeApproveRoute(request.envelopeId) : envelopeDeclineRoute(request.envelopeId),
        { method: "POST", headers: { "content-type": "application/json" } },
      );
      const body = (await response.json().catch(() => null)) as { execution?: Execution; error?: string } | null;
      if (response.ok) {
        if (choice === "decline") setOutcome({ tone: "done", text: "Declined. Nothing was changed." });
        else if (body?.execution?.status === "executed") setOutcome({ tone: "done", text: "Authorized and done." });
        else setOutcome({ tone: "problem", text: `Authorized. ${body?.execution?.message ?? "Nothing has run yet."}` });
        return;
      }
      if (response.status === 409) {
        setOutcome({ tone: "problem", text: body?.error ?? "This request was already decided." });
        return;
      }
      setOutcome({ tone: "problem", text: body?.error ?? "That decision could not be saved. Open it in Needs-you." });
    } catch {
      setOutcome({ tone: "problem", text: "The decision may not have been saved. Check it in Needs-you before deciding again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      data-testid="inline-approval-request"
      style={{
        border: "1px solid color-mix(in srgb, var(--dpf-accent) 40%, transparent)",
        borderRadius: 8,
        padding: "8px 10px",
        background: "color-mix(in srgb, var(--dpf-surface-1) 80%, transparent)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)" }}>
        {APPROVALS.card.authorizationNeeded}: {readable(request.toolName)}
      </div>
      <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{request.rationale}</div>
      {request.expiresAt && open ? (
        <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
          {stateLabel("waiting")} · <time dateTime={request.expiresAt}>{request.expiresAt.slice(0, 16).replace("T", " ")} UTC</time>
        </div>
      ) : null}
      {open ? (
        <EnvelopeDecisionButtons
          pending={pending}
          onAuthorize={() => void decide("approve")}
          onDecline={() => void decide("decline")}
        />
      ) : outcome ? (
        <div role="status" style={{ fontSize: 11, color: outcome.tone === "done" ? "var(--dpf-success)" : "var(--dpf-error)" }}>
          {outcome.text}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{stateLabel(request.status)}</div>
      )}
      <a href={envelopeInboxRoute(request.envelopeId)} style={{ fontSize: 10, color: "var(--dpf-accent)" }}>
        {APPROVALS.details}
      </a>
    </div>
  );
}
