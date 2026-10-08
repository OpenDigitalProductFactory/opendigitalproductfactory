"use client";

// Deciding another person's coworker request (BI-7BCC87BB, plan B8,
// AC-OVERRIDE; WWMD DI-18258852EB33 chose this card-level control).
//
// Shown instead of Authorize / Decline only to an admin who is not the person
// whose authority the request lends (the user-management capability, checked
// by the server again on every decision). One button opens a required reason;
// the same Authorize / Decline pair then decides, and the reason is recorded
// on the request and in the audit log. Presentational: the card posts.

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { TextareaField } from "@/components/ui/form/TextareaField";
import { SOURCE_CATALOG } from "@dpf/i18n";
import { DEFAULT_LOCALE, formatSource } from "@dpf/i18n/runtime";

import { EnvelopeDecisionButtons } from "./EnvelopeDecisionButtons";

const COPY = SOURCE_CATALOG.approvals.card;

export function OnBehalfDecision({
  ownerLabel,
  pending,
  onDecide,
}: {
  ownerLabel: string;
  pending: boolean;
  onDecide: (choice: "approve" | "decline", reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length > 0;

  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--dpf-text)]" role="note">
        {formatSource(DEFAULT_LOCALE, COPY.onBehalfWaiting, { owner: ownerLabel })}
      </p>
      {open ? (
        <>
          <TextareaField
            name="on-behalf-reason"
            label={COPY.onBehalfReason}
            hint={COPY.onBehalfReasonHint}
            value={reason}
            onValueChange={setReason}
            rows={2}
          />
          <EnvelopeDecisionButtons
            pending={pending}
            disabled={!ready}
            onAuthorize={() => onDecide("approve", reason.trim())}
            onDecline={() => onDecide("decline", reason.trim())}
          />
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {COPY.decideOnBehalf}
        </Button>
      )}
    </div>
  );
}

/** "Decided by ADMIN on behalf of OWNER: REASON" for the settled card. */
export function decidedOnBehalfText(record: { by: string; onBehalfOf: string; reason: string }): string {
  return formatSource(DEFAULT_LOCALE, COPY.decidedOnBehalf, { by: record.by, owner: record.onBehalfOf, reason: record.reason });
}
