import type { WorkCapsuleStatus } from "@/lib/work-capsules";

export const PRE_HUMAN_ROUTING_DISPOSITIONS = [
  "factual-clarification",
  "owner-consent",
  "scope-resolved",
  "legitimate-escalation",
] as const;

export type PreHumanRoutingDisposition = (typeof PRE_HUMAN_ROUTING_DISPOSITIONS)[number];

const DISPOSITION_SET = new Set<string>(PRE_HUMAN_ROUTING_DISPOSITIONS);
const DECISION_INTERACTION_ID = /^DI-[A-Z0-9][A-Z0-9-]{3,}$/;

// Deliberately high precision. This gate protects decision-shaped interruptions;
// unavailable credentials, providers, files, and runtimes remain factual
// blockers and do not need a fabricated decision receipt.
const DECISION_SHAPED_BLOCKER = [
  /\b(?:operator|owner|user|human)\b.{0,80}\b(?:choose|decide|pick|tell|say)\b/i,
  /\b(?:choose|decide|pick)\b.{0,80}\b(?:approach|option|scope|task|path|whether)\b/i,
  /\b(?:which|what)\s+(?:approach|option|scope|task|path)\b/i,
  /\bshould\s+(?:I|we)\b/i,
  /\bif\s+you\s+(?:say|want)\b.{0,80}\b(?:create|continue|proceed|finish|complete)\b/i,
];

export function isDecisionShapedWorkroomReason(reason: string): boolean {
  return DECISION_SHAPED_BLOCKER.some((pattern) => pattern.test(reason));
}

export type PreHumanRoutingValidation =
  | { valid: true; disposition: PreHumanRoutingDisposition | null; decisionInteractionId: string | null }
  | { valid: false; error: "decision_routing_required" | "invalid_routing_disposition" | "decision_interaction_required"; message: string };

export function validatePreHumanRouting(args: {
  status: WorkCapsuleStatus;
  reason: string;
  routingDisposition?: unknown;
  decisionInteractionId?: unknown;
}): PreHumanRoutingValidation {
  const rawDisposition = typeof args.routingDisposition === "string"
    ? args.routingDisposition.trim()
    : "";
  const disposition = rawDisposition && DISPOSITION_SET.has(rawDisposition)
    ? rawDisposition as PreHumanRoutingDisposition
    : null;
  const decisionInteractionId = typeof args.decisionInteractionId === "string"
    ? args.decisionInteractionId.trim()
    : "";

  if (rawDisposition && !disposition) {
    return {
      valid: false,
      error: "invalid_routing_disposition",
      message: `routingDisposition must be one of: ${PRE_HUMAN_ROUTING_DISPOSITIONS.join(", ")}.`,
    };
  }
  if (decisionInteractionId && !DECISION_INTERACTION_ID.test(decisionInteractionId)) {
    return {
      valid: false,
      error: "decision_interaction_required",
      message: "decisionInteractionId must use the DI-* format.",
    };
  }

  const decisionShaped = args.status === "blocked" && isDecisionShapedWorkroomReason(args.reason);
  if (decisionShaped && !disposition) {
    return {
      valid: false,
      error: "decision_routing_required",
      message:
        "A decision-shaped Workroom blocker must record routingDisposition. Consult the owning WWMD/WWWD/WSID scope before escalating; factual infrastructure blockers need no disposition.",
    };
  }

  if ((disposition === "scope-resolved" || disposition === "legitimate-escalation") && !decisionInteractionId) {
    return {
      valid: false,
      error: "decision_interaction_required",
      message: `${disposition} requires the existing DecisionInteraction id in decisionInteractionId.`,
    };
  }

  return {
    valid: true,
    disposition,
    decisionInteractionId: decisionInteractionId || null,
  };
}
