"use client";

import { useId, useState } from "react";

import type { ProviderReviewPacket } from "@/lib/routing/provider-suitability/provider-review-packet";

// Shared "hand this to the coworker" affordance (BI-01EA3EBE).
//
// Several surfaces report a platform problem but historically offered no route
// to help — some even rendered dead "Ask AI Coworker…" plain text. This button
// is the one canonical wire: it dispatches the same `open-agent-panel` event
// Build Studio and the health surfaces use, carrying a context-rich prompt so
// the user never transcribes jargon. Server components can import it directly
// and pass a server-composed prompt.

type Props = {
  /** Optional autoMessage for explicit diagnostic handoffs. Omit to open the panel without sending. */
  prompt?: string;
  /** Route whose coworker should answer (e.g. "/admin", "/platform"). Omit to use the current route's coworker. */
  routeContext?: string;
  /** Validated, minimized provider review context for the deterministic COO consultation path. */
  providerReviewPacket?: ProviderReviewPacket;
  label?: string;
  className?: string;
  title?: string;
  ariaDescribedBy?: string;
  confirmation?: {
    title: string;
    contextSummary: string;
    expectedNextStep: string;
    confirmLabel?: string;
  };
  /** Custom content (e.g. a badge) instead of the text label. */
  children?: React.ReactNode;
};

export function AskCoworkerButton({
  prompt,
  routeContext,
  providerReviewPacket,
  label = "Ask coworker",
  className = "text-[var(--dpf-accent)] hover:underline underline-offset-2",
  title,
  ariaDescribedBy,
  confirmation,
  children,
}: Props) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const confirmationId = useId();

  function openCoworker() {
    document.dispatchEvent(
      new CustomEvent("open-agent-panel", {
        detail: {
          ...(prompt ? { autoMessage: prompt } : {}),
          ...(routeContext ? { routeContext } : {}),
          ...(providerReviewPacket ? { providerReviewPacket } : {}),
        },
      }),
    );
    setConfirmationOpen(false);
  }

  const trigger = (
    <button
      type="button"
      onClick={() => confirmation ? setConfirmationOpen(true) : openCoworker()}
      className={className}
      title={title}
      aria-describedby={ariaDescribedBy}
      aria-expanded={confirmation ? confirmationOpen : undefined}
      aria-controls={confirmation ? confirmationId : undefined}
      data-dpf-primary-action={confirmation ? "true" : undefined}
    >
      {children ?? label}
    </button>
  );

  if (!confirmation) return trigger;

  return (
    <div>
      {trigger}
      {confirmationOpen && (
        <div
          id={confirmationId}
          role="region"
          aria-label={confirmation.title}
          className="mt-dpf-sm rounded-dpf-md border border-dpf-border bg-dpf-surface-2 p-dpf-sm text-dpf-body text-dpf-text"
        >
          <p className="m-0 font-dpf-semibold">{confirmation.title}</p>
          <dl className="mt-dpf-sm grid gap-dpf-sm">
            <div>
              <dt className="text-dpf-caption font-dpf-medium text-dpf-muted">Context used</dt>
              <dd className="m-0 mt-dpf-2xs">{confirmation.contextSummary}</dd>
            </div>
            <div>
              <dt className="text-dpf-caption font-dpf-medium text-dpf-muted">Expected next step</dt>
              <dd className="m-0 mt-dpf-2xs">{confirmation.expectedNextStep}</dd>
            </div>
          </dl>
          <div className="mt-dpf-sm flex flex-wrap gap-dpf-xs">
            <button
              type="button"
              onClick={() => setConfirmationOpen(false)}
              className="dpf-tap-target rounded-dpf-md border border-dpf-border bg-dpf-surface-1 px-dpf-sm text-dpf-body text-dpf-text"
            >
              Cancel
            </button>
            <button
              type="button"
              data-confirm-agent-work="true"
              onClick={openCoworker}
              className="dpf-tap-target rounded-dpf-md bg-dpf-accent px-dpf-sm text-dpf-body font-dpf-semibold text-dpf-bg"
            >
              {confirmation.confirmLabel ?? "Send to coworker"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
