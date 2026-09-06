// What an off-site message is allowed to say.
// Spec: docs/superpowers/specs/2026-08-01-attention-reach-layer-design.md §4.5
//
// OWASP "Lies in the Loop": an email is an untrusted rendering surface and an attacker-
// influenceable one — an agent's proposed action, a customer's message, a supplier's
// invoice line can all contain text chosen by someone else. If the operator reads WHAT to
// approve inside the email, the email becomes the place they can be lied to, and the
// authenticated surface becomes decoration.
//
// So the message carries the SHAPE of the decision, never its content: which outcome class
// needs them, how urgent it is, and a link. The raw action is shown on the authenticated
// surface beside the AI brief, where it can be attributed and audited.
//
// The copy also follows the plain-language rules from the cognitive-load redesign
// (docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md): short
// sentences, no jargon, and never a claim that the operator can act from here when they
// cannot.

import type { ReachDecision } from "./reach-policy";
import type { AttentionSource } from "./types";

export type ReachMessage = {
  subject: string;
  textBody: string;
};

/**
 * Owner-language name for what needs them, keyed by source.
 *
 * Deliberately generic: "A bill needs approving" and not the supplier, the amount, or the
 * line items. Someone reading over a shoulder on a train learns that a bill exists — which
 * is the least the message can convey while still being worth sending.
 */
const OUTCOME_CLASS: Record<AttentionSource, string> = {
  "approval-bill": "A bill needs your approval",
  "approval-expense": "An expense claim needs your approval",
  "approval-outbound": "A message to a customer needs your approval",
  "compliance-submission": "A filing needs your approval",
  "reservation-exception": "A booking needs your decision",
  "storefront-inquiry": "A customer is waiting for a reply",
  "hospitality-capacity": "A table or kitchen station needs your decision",
  "business-journey": "Something your customers rely on has stopped working",
  "ai-decision": "A business decision needs you",
  "agent-proposal": "A coworker is asking permission",
  "coworker-envelope": "A coworker is waiting for your approval",
  "skill-proposal": "A change to a coworker skill needs your approval",
  "paused-ai": "A coworker is waiting on you",
  "research-proposal": "A research request needs approving",
  "coworker-memory": "A coworker recorded something new",
  escalation: "A build needs a decision",
  // The four below are custodian-lane sources that never earn an off-site send today
  // (see reach-policy). Copy is defined so a future routing change cannot silently fall
  // back to a generic string, and is written to the same plain-language bar as the rest.
  "scheduled-task": "A scheduled job stopped working",
  "ai-readiness-blocker": "Your AI setup is not finished",
  "platform-health": "A platform service is having trouble",
  "provider-credential": "A connection needs reconnecting",
  "compliance-source-freshness": "Compliance evidence is going out of date",
  "workroom-stall": "A room full of work has stopped moving",
};

const URGENCY_LINE: Record<ReachDecision["urgency"], string> = {
  routine: "",
  priority: "This one matters today.",
  urgent: "This is overdue.",
  emergency: "This needs you now.",
};

export function outcomeClassFor(source: AttentionSource): string {
  return OUTCOME_CLASS[source] ?? "Something needs you";
}

/**
 * Compose the message. `linkUrl` is the signed reach link.
 *
 * Note what is NOT a parameter: the attention item's title, context, or blast radius. The
 * composer cannot leak business content because it is never handed any.
 */
export function composeReachMessage(input: {
  source: AttentionSource;
  decision: ReachDecision;
  linkUrl: string;
  businessName?: string;
}): ReachMessage {
  const outcome = outcomeClassFor(input.source);
  const urgency = URGENCY_LINE[input.decision.urgency];
  const prefix = input.businessName ? `${input.businessName}: ` : "";

  const lines = [outcome + ".", urgency, "", "Open it here:", input.linkUrl, ""];

  // Say plainly when the decision cannot be made from the message. An operator who taps a
  // link expecting a one-tap approval and lands on a sign-in screen has been misled by the
  // message, which costs more trust than the extra tap costs patience.
  lines.push(
    input.decision.oneClickEligible
      ? "You will need to sign in to decide."
      : "You will need to sign in to decide. This one cannot be approved from an email.",
  );

  return {
    subject: `${prefix}${outcome}`,
    textBody: lines.filter((line) => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}
