// apps/web/lib/tak/convene-clearance.ts
//
// BI-154DAA7E: clamp a CONVENE to the asking human's clearance.
//
// What was already enforced, so this is not mistaken for a second copy of it:
// every governed coworker TOOL CALL is already an intersection of the asking
// human's clearance with the acting agent's data sensitivity —
// `coworker-authority-decision.ts` denies `sensitivity-clearance-denied` when
// `authContext.sensitivityClearance` does not include `dataPolicy.sensitivity`,
// with authContext resolved from the requesting user and `actingAgentId` set.
//
// Two gaps that gate leaves open, both on the CONVENING side rather than the
// tool side:
//
//  1. The conversational channel is not a tool call. A peer brought into a
//     thread composes prose from its own model context — system prompt,
//     working notes, profession corpus, its own earlier turns. The tool gate
//     inspects tool arguments and results; it cannot inspect generated text.
//     Disclosure does not need a tool: "you may want to hold off on that hire"
//     leaks without one.
//  2. Nothing stops the convene itself. `enforceHandoffAuthority` gates only on
//     the caller agent's delegatesTo/escalatesTo. A peer classified above the
//     asking human's clearance can therefore be admitted, generate prose, and
//     have only its tool calls denied — a half-participating coworker that is
//     both confusing and leaky.
//
// Refusing at the convene is the cheaper and more honest fix: an over-cleared
// peer is never in the room, so there is no prose channel to police. The tool
// gate stays as defence in depth behind it.
import { coerceDataSensitivity, type PrincipalSensitivity } from "@dpf/db/principal-sensitivity";

export type ConveneClearanceDecision =
  | { permitted: true }
  | { permitted: false; reason: "insufficient-clearance" };

/**
 * May this human have this coworker convened into their conversation?
 *
 * Mirrors the tool gate's test exactly — set membership of the agent's
 * sensitivity in the human's clearance list, NOT a rank comparison. Clearance
 * is a set of granted levels, so a principal holding {public, internal,
 * restricted} but not "confidential" is denied a confidential peer. Diverging
 * to a rank comparison here would silently widen access relative to the tool
 * gate and let a convene succeed where every subsequent tool call is denied.
 *
 * Unknown/absent agent sensitivity coerces to "restricted" (fail closed) via
 * `coerceDataSensitivity`, so a misconfigured or unlabelled coworker is never
 * convened by default rather than being treated as public.
 */
export function decideConveneClearance(input: {
  askingHumanClearance: readonly string[];
  targetAgentSensitivity: string | null | undefined;
}): ConveneClearanceDecision {
  const required: PrincipalSensitivity = coerceDataSensitivity(input.targetAgentSensitivity);
  return input.askingHumanClearance.includes(required)
    ? { permitted: true }
    : { permitted: false, reason: "insufficient-clearance" };
}

/**
 * The operator-facing refusal.
 *
 * This string is load-bearing for disclosure, not just tone. The platform's
 * limitation-response contract tells a blocked coworker to name the ONE thing
 * that would unblock it and ask for a yes/no — which is exactly the wrong
 * instinct here: "ask an admin to grant you confidential clearance" reveals
 * that a restricted matter exists and hints at its class. A refusal that
 * discloses is not a refusal.
 *
 * So this message names no peer, no role, no sensitivity level, and no subject,
 * and it proposes no enabler. It is deliberately indistinguishable from "no
 * such specialist is available", which is the only shape that leaks nothing.
 */
export const CONVENE_DENIED_MESSAGE =
  "I can't bring anyone else in on this one. Let me help with what I can see myself, " +
  "or you can raise it with your manager if you think someone else should be involved.";

/** Audit-side reason. Never rendered to the asking human — see the message above. */
export function conveneDenialAuditReason(p: {
  targetAgentId: string;
  requiredSensitivity: string;
}): string {
  return `convene of ${p.targetAgentId} denied: asking human's clearance does not include ${p.requiredSensitivity}`;
}
