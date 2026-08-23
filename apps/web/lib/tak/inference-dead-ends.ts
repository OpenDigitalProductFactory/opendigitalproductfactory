// apps/web/lib/tak/inference-dead-ends.ts
//
// The replies a coworker gives when no model answered (BI-33F1EA72).
//
// WHY THESE LIVE TOGETHER, AND HERE. Measured on the live install
// (2026-08-23, served b8777fbb1952): 196 of 1,138 assistant messages — 17.2% —
// were dead ends, and they were dominated by provider availability:
//
//     provider temporarily unavailable      114   58%
//     providers momentarily busy             50   26%
//     no eligible model / routing            19   10%
//     local model not strong enough          12    6%
//
// Rung 4 of the escalation ladder was originally wired only to the last of
// those — 6% of the problem — because that was the one string I had seen in a
// session log. The other 84% still ended on "Please try again in about 30
// seconds", which asks the user to poll and is the exact shape the rung exists
// to replace: it names a limitation and stops.
//
// Kept out of agentic-loop.ts because that file is the largest module in the
// repo and its size ratchet only permits shrinking; copy this length does not
// belong in that budget.
import { buildHumanHandoff } from "./escalation-ladder";

/** Routing eliminated every candidate — a real configuration question. */
export function noEligibleModelHandoff(): string {
  return buildHumanHandoff({
    blocker:
      "No AI model can handle this request right now — no available model met this turn's requirements.",
    steps: [
      "Open Platform > AI Operations > Providers & Routing.",
      "Check the active route for this coworker: provider status, data-policy or residency limits, capability requirements, and context size.",
    ],
    verify: "re-check which models this coworker can reach",
  });
}

/**
 * Endpoints exist but all transiently failed. Genuinely nothing to configure,
 * so the hand-off is one step — but it stays a hand-off, so the reply ends on
 * the user's next action rather than on the outage.
 */
export function providersBusyHandoff(): string {
  return buildHumanHandoff({
    blocker:
      "Every AI provider is busy right now — usually rate-limited or briefly overloaded. Nothing is misconfigured.",
    steps: ["Give it about 30 seconds, then send the message again."],
    verify: "pick this up on the next try",
  });
}

/** The single most common dead end on a real install. */
export function providerUnreachableHandoff(): string {
  return buildHumanHandoff({
    blocker: "I can't reach an AI provider at the moment, so I couldn't answer this.",
    steps: [
      "Open Platform > AI Operations > Providers & Routing.",
      "Reconnect or add a provider — an expired sign-in or exhausted quota is the usual cause.",
    ],
    verify: "confirm a provider is reachable",
  });
}
