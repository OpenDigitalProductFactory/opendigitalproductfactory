// AI-led volunteering — funding the bet pulls a coworker forward.
// EP-DELIVERY-FLOW BI-A6648529.
//
// When a demand item crosses the bet (approve_demand_for_funding → demandStage
// "ready", funded), the platform's operator stance is AI-LED EXECUTION: a
// coworker volunteers to claim the funded item and build it, rather than waiting
// to be assigned. But whether it may CLAIM AND ACT on its own — vs. ask a human
// first — is a GOVERNED autonomy decision.
//
// Autonomy authority is the work-management **autonomy envelope**
// (`apps/web/lib/work-management/autonomy-envelope.ts`): the coworker's trust
// level, capped by the item's risk and any regulatory ceiling, resolves to a
// `WorkCaseAutonomyDecisionMode`. Only `autonomous-action` (autopilot trust,
// within ceiling) permits an autonomous claim.
//
// IMPORTANT (learned 2026-07-15): this is NOT the proactivity `actionBoundary`.
// Proactivity is *cadence*, not *autonomy* — no proactivity level ever resolves
// to a "preauthorized" boundary (assertive tops out at "propose"), so keying
// auto-claim on the proactivity plan would make it either dead or mis-governed.
// The autonomy envelope is the correct, risk-ceilinged authority axis.
//
// Spec: docs/superpowers/specs/2026-07-12-delivery-flow-demand-backlog-unification-design.md
// §"AI-led execution (the synced bet)". Plan:
// docs/superpowers/plans/2026-07-15-ai-led-volunteering-plan.md.

import type { WorkCaseAutonomyDecisionMode } from "@/lib/work-management/autonomy-envelope";

/**
 * What a coworker does with a freshly-funded item, given its resolved autonomy
 * decision mode:
 * - `auto_claim` — the coworker is trusted (within the risk ceiling) to claim and
 *   start building on its own (the synced bet advances without a human turn).
 * - `ask_first` — the coworker surfaces a needs-you gate ("shall I take this?")
 *   and waits for the operator, keeping humans at the lead altitude.
 * - `observe` — shadow-only: the coworker cannot act or ask; the bet stays for a
 *   human to assign.
 */
export type VolunteeringDecision = "auto_claim" | "ask_first" | "observe";

/**
 * Decide how a coworker volunteers for a funded item from its resolved
 * work-case autonomy decision mode. Pure. `autonomous-action` is the only mode
 * that permits an autonomous claim; `propose-for-approval` and
 * `supervised-action` both surface the pickup for a human yes; `shadow-only`
 * observes (no claim, no ask).
 */
export function decideVolunteering(decisionMode: WorkCaseAutonomyDecisionMode): VolunteeringDecision {
  switch (decisionMode) {
    case "autonomous-action":
      return "auto_claim";
    case "shadow-only":
      return "observe";
    case "propose-for-approval":
    case "supervised-action":
      return "ask_first";
  }
}

/**
 * Whether a funded item should raise a coworker-pickup offer (the ask-first
 * needs-you gate). Pure. An offer is raised only when a coworker is associated
 * with the item and it is not already claimed or offered — so re-funding or a
 * repeated approval never double-offers (idempotent).
 *
 * EP-DELIVERY-FLOW ships the ask-first path first (kernel decision, high conf):
 * every funded bet asks a human to approve the pickup; the autonomous auto-claim
 * path is deferred until the coworker execution-trust source-of-truth is decided
 * (see the plan's blocker section). So volunteering currently always asks.
 */
export function shouldOfferToCoworker(item: {
  agentId: string | null;
  claimStatus: string | null;
}): boolean {
  if (!item.agentId) return false;
  if (item.claimStatus === "claimed" || item.claimStatus === "offered") return false;
  return true;
}
