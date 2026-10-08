"use client";

// The shared Authorize / Decline surface for one CoworkerActionEnvelope
// (BI-C8EC05C9). Extracted from CoworkerEnvelopeApproval so the Needs-you card
// and the inline chat card offer the same two verbs, worded and styled once.
// Presentational only: the caller owns the request and its outcome.

import { Button } from "@/components/ui/Button";
import { SOURCE_CATALOG } from "@dpf/i18n";

const COPY = SOURCE_CATALOG.approvals.card;

export function EnvelopeDecisionButtons({
  pending,
  onAuthorize,
  onDecline,
}: {
  pending: boolean;
  onAuthorize: () => void;
  onDecline: () => void;
}) {
  return (
    <>
      {pending ? (
        <p className="text-xs text-[var(--dpf-muted)]" role="status">
          {COPY.saving}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={onAuthorize}>
          Authorize
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={onDecline}>
          Decline
        </Button>
      </div>
    </>
  );
}
