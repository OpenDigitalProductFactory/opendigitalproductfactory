// User-facing copy for the two provider-side failures the agentic loop cannot
// recover from on its own. Extracted from agentic-loop (BI-7F2FBDA3) so that
// module keeps shrinking under its module-size baseline.

import type { RoutedInferenceResult } from "@/lib/routed-inference";

import { buildHumanHandoff } from "./escalation-ladder";

export function buildDowngradedFabricationMessage(): string {
  return (
    "My usual AI provider was unavailable, so I worked through a backup that "
    + "couldn't fully complete this — nothing was left half-saved on your side. "
    + "Please try again (the primary connection may have recovered), or break "
    + "the request into a smaller step."
  );
}

export function buildLocalToolCallFailureMessage(_result: RoutedInferenceResult): string {
  // Respects IDENTITY_BLOCK rule #5 — no infrastructure names, model ids, or
  // routing architecture; engineers get those from RoutedInferenceResult.
  // Copy must stay honest (G2, 2026-05-23): an earlier version promised a
  // re-route the loop never performs.
  // Rung 4 (BI-33F1EA72): connecting a provider is work only the human can do,
  // so this hands off rather than apologizing — steps, then the resumption.
  return buildHumanHandoff({
    blocker: "I'm on the local AI here, and it couldn't carry this one through.",
    steps: ["Open Platform > AI > Providers.", "Connect a stronger provider — Claude, Gemini, or OpenAI."],
    verify: "confirm the stronger provider is live",
  });
}

