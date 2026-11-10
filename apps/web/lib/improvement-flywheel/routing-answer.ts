/**
 * The routing answer a recurring miss carries when it is filed
 * (BI-B146AB6B, EP-C00F61F4; the slice F8c needs, DI-58C43DCC688E).
 *
 * For a recurring miss, ask in order and stop at the first yes:
 *   1. Decidable from data present at the moment of action? → a GATE there.
 *   2. Undecidable per instance but the input space is closed? → an EXHAUSTIVE
 *      WALK in a test.
 *   3. Needs judgment over prose? → a SUB-AGENT with a purpose-built job.
 *   4. None of those? → DOCTRINE, generated from the rule it describes.
 *
 * A control binds to a work shape (or a stage of one), not to a room, so a new
 * room of that shape inherits it. This module only types and checks the
 * answer; the platform-wide control registry and its conformance walk remain
 * BI-B146AB6B's.
 */
export const ROUTING_KINDS = ["gate", "exhaustive-walk", "sub-agent", "doctrine"] as const;
export type RoutingKind = (typeof ROUTING_KINDS)[number];

export type RoutingAnswer = {
  kind: RoutingKind;
  /** Which of the four questions answered yes: 1 gate, 2 walk, 3 sub-agent, 4 doctrine. */
  question: 1 | 2 | 3 | 4;
  /** What the control binds to, e.g. `work-shape:delivery-small#stage:repair`. */
  bindsTo: string;
  /** Why that question is the first yes, in a sentence. */
  reason: string;
};

/** A reason the answer is malformed, or null when it is well-formed. */
export function routingAnswerProblem(answer: RoutingAnswer): string | null {
  const index = ROUTING_KINDS.indexOf(answer.kind);
  if (index < 0) return `routing.kind must be one of: ${ROUTING_KINDS.join(" | ")}.`;
  if (answer.question !== index + 1) return `routing.question must be ${index + 1} for a ${answer.kind}.`;
  if (!answer.bindsTo.trim()) return "routing.bindsTo must name what the control binds to.";
  if (!answer.reason.trim()) return "routing.reason must say why that question is the first yes.";
  return null;
}
