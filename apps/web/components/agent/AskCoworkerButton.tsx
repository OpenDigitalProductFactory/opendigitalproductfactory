"use client";

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
  /** The autoMessage the coworker receives — include the facts, not just "help". */
  prompt: string;
  /** Route whose coworker should answer (e.g. "/admin", "/platform"). Omit to use the current route's coworker. */
  routeContext?: string;
  /** Validated, minimized provider review context for the deterministic COO consultation path. */
  providerReviewPacket?: ProviderReviewPacket;
  label?: string;
  className?: string;
  title?: string;
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
  children,
}: Props) {
  return (
    <button
      type="button"
      onClick={() =>
        document.dispatchEvent(
          new CustomEvent("open-agent-panel", {
            detail: {
              autoMessage: prompt,
              ...(routeContext ? { routeContext } : {}),
              ...(providerReviewPacket ? { providerReviewPacket } : {}),
            },
          }),
        )
      }
      className={className}
      title={title}
    >
      {children ?? label}
    </button>
  );
}
