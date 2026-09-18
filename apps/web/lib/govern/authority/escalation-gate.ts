/**
 * ESCALATION IS A PROPERTY OF THE DECISION, NOT OF THE ACTOR (BI-6B3DA9DD).
 *
 * Founder ruling, 2026-09-09: "The only reason to escalate to a human is for
 * more sensitive, damaging decisions, notably if there is no automated
 * decision process to steer decisions, as the delegation system for the human
 * in the loop." And, on where the rule belongs: "less prose, more process" —
 * so it lives here, in the seam every install runs with no AI client present,
 * not in an agent's memory and not only in a principle page.
 *
 * WHAT WAS WRONG. `requiresApproval` asked one question: does this coworker's
 * HITL tier say "approve side effects"? That is a property of the ACTOR. Every
 * specialist reviewer (AGT-WS-PORTFOLIO / -REVIEW / -EA) ships at
 * `hitlTierDefault: 1`, which `deriveCoworkerApprovalPolicy` maps to "all", so
 * every side-effecting call they made minted a human approval envelope —
 * including `record_initiative_evidence`, a platform receipt that declares no
 * consequence and decides nothing damaging. The reviewers ARE the automated
 * decision process, and the platform escalated them anyway. Observed
 * 2026-09-05 (WC-375F098A) and again 2026-09-09 driving BI-947780FE /
 * BI-F114354D / BI-7ADEBDC1, where it reached the founder as an approval
 * request — the thing that must never happen.
 *
 * TWO AUTHORITIES, DELIBERATELY SEPARATE.
 *
 *   The OPERATOR decides, per coworker, whether ordinary side effects need
 *   approval at all. That is a standing configuration and this gate does not
 *   touch it: a coworker the operator has already graduated keeps acting alone,
 *   exactly as before.
 *
 *   THIS GATE decides, for a coworker whose configuration does require
 *   approval, whether this particular action truly needs a person:
 *     • damaging          → yes. A coworker's steering does not decide damage.
 *     • steered           → no. The delegation system is the human in the loop.
 *     • unsteered         → yes. Nothing can decide it, so someone must.
 *
 * TIGHTEN-ONLY, INVERTED. Every branch below either matches what the platform
 * did before or REMOVES an escalation the rule says should not exist. Nothing
 * here escalates an action that did not escalate before, because a gate that
 * fixed over-escalation by adding new envelopes would be the same defect
 * wearing the opposite coat.
 *
 * Pure and synchronous by construction: it sits on the governed hot path and
 * every input is already resolved by the caller.
 */
import type { PrincipalSensitivity } from "@dpf/db/principal-sensitivity";
import type { ToolConsequence, ToolConsequenceScope } from "@/lib/mcp-tools";

/**
 * Sensitivities at which an action is damaging on data grounds alone,
 * independent of what the tool declares about its reach.
 */
export const DAMAGING_SENSITIVITIES: readonly PrincipalSensitivity[] = ["restricted"];

/**
 * What can steer a decision without a person.
 *
 * Each is a RECORDED, server-resolved fact about THIS action, never a caller
 * claim and never a standing property of the actor:
 *  • independent-reviewer — the actor executes a server-validated immutable
 *    initiative-review binding. Separation of duties is enforced as distinct
 *    principals, so a human click adds nothing the binding has not established.
 *  • room-authority — the turn runs in a Workroom the coworker participates in
 *    whose resolved action boundary is `preauthorized`; the room definition is
 *    the recorded decision (EP-WORK-POSTURE §8.2). A boundary of `advise` or
 *    `propose` supplies NO steering, so a room can only narrow, never widen.
 *  • wwmd — a recorded `principle_decide` outcome that is autonomy-eligible
 *    for this exact action.
 */
export const ESCALATION_STEERING = [
  "independent-reviewer",
  "room-authority",
  "wwmd",
  "none",
] as const;
export type EscalationSteering = (typeof ESCALATION_STEERING)[number];

export const ESCALATION_REASON_CODES = [
  "routine-read",
  "operator-graduated-coworker",
  "steered-by-independent-reviewer",
  "steered-by-room-authority",
  "steered-by-wwmd",
  "damaging-consequence",
  "damaging-sensitivity",
  "damaging-work-case",
  "declared-proposal",
  "unsteered-side-effect",
] as const;
export type EscalationReasonCode = (typeof ESCALATION_REASON_CODES)[number];

export type EscalationDecision = {
  /** `human` mints an approval envelope; `automated` never does. */
  verdict: "automated" | "human";
  reasonCode: EscalationReasonCode;
  /** Recorded on the authority evidence so an operator sees which branch decided. */
  damaging: boolean;
  steering: EscalationSteering;
};

export type EscalationInput = {
  action: {
    sideEffect: boolean;
    executionMode: "proposal" | "immediate";
    /** Declared reach. Any declared consequence is damaging. */
    consequence?: ToolConsequence | null;
    consequenceScope?: ToolConsequenceScope | null;
    /** A Work Case may elevate an otherwise ordinary mutation. */
    workCaseConsequential?: boolean;
  };
  dataPolicy: { sensitivity: PrincipalSensitivity };
  /**
   * The operator's standing configuration for this coworker: does it require
   * approval for ordinary side effects at all? False means the operator has
   * already graduated it, and this gate leaves that untouched.
   */
  operatorRequiresApproval: boolean;
  /** Server-resolved; `none` when nothing recorded can steer this action. */
  steering: EscalationSteering;
};

/** Is this action damaging? Any one of the three grounds is enough. */
export function isDamagingAction(input: EscalationInput): boolean {
  if (input.action.workCaseConsequential === true) return true;
  if (input.action.consequence) return true;
  return DAMAGING_SENSITIVITIES.includes(input.dataPolicy.sensitivity);
}

function damagingReason(input: EscalationInput): EscalationReasonCode {
  if (input.action.workCaseConsequential === true) return "damaging-work-case";
  if (input.action.consequence) return "damaging-consequence";
  return "damaging-sensitivity";
}

const STEERED_REASON: Record<
  Exclude<EscalationSteering, "none">,
  EscalationReasonCode
> = {
  "independent-reviewer": "steered-by-independent-reviewer",
  "room-authority": "steered-by-room-authority",
  wwmd: "steered-by-wwmd",
};

/**
 * The one escalation decision. The ORDER is the safety property, so every
 * branch is pinned by a test and by the conformance guard's exhaustive walk.
 */
export function resolveEscalation(input: EscalationInput): EscalationDecision {
  const damaging = isDamagingAction(input);
  const steering = input.steering;
  const base = { damaging, steering } as const;

  // 1. A tool declared as a proposal exists to be put to someone. That is its
  //    declared shape, not a judgment about damage, and it outranks every
  //    branch below — including the read shortcut, since a proposal tool that
  //    reads nothing is still a proposal.
  if (input.action.executionMode === "proposal") {
    return { verdict: "human", reasonCode: "declared-proposal", ...base };
  }

  // 2. An immediate read decides nothing and commits nothing.
  if (!input.action.sideEffect) {
    return { verdict: "automated", reasonCode: "routine-read", ...base };
  }

  // 3. The operator already graduated this coworker. Not this gate's call.
  if (!input.operatorRequiresApproval) {
    return { verdict: "automated", reasonCode: "operator-graduated-coworker", ...base };
  }

  // 4. Damage is decided by a person, not by a coworker's steering.
  if (damaging) {
    return { verdict: "human", reasonCode: damagingReason(input), ...base };
  }

  // 5. Something recorded can decide this. The delegation system is the human
  //    in the loop — this is the branch the reviewer lane was missing.
  if (steering !== "none") {
    return { verdict: "automated", reasonCode: STEERED_REASON[steering], ...base };
  }

  // 6. Nothing can decide it, and it commits something. Ask a person.
  return { verdict: "human", reasonCode: "unsteered-side-effect", ...base };
}

/**
 * The rule in words, derived from the same constants the gate runs on.
 * `check-escalation-gate.ts` fails the build unless the kernel principle page
 * states these verbatim, so what an agent reads and what the platform enforces
 * cannot drift (BI-6B3DA9DD: the principle follows the process).
 */
export function describeEscalationRule(): string[] {
  return [
    "Escalation is a property of the decision, not of the acting coworker's trust tier.",
    "A coworker whose operator has already graduated it keeps acting alone; this gate never widens that.",
    "For every other coworker, a human is engaged only when the action is damaging, or when nothing recorded can steer it.",
    `An action is damaging when it declares a consequence (${["outward", "irreversible", "authority"].join(", ")}), when a Work Case declares it consequential, or when its data sensitivity is ${DAMAGING_SENSITIVITIES.join(" or ")}.`,
    "A damaging action is decided by a person; a coworker's steering does not decide damage.",
    `Automated steering is a recorded, server-resolved fact about the action itself: ${ESCALATION_STEERING.filter((s) => s !== "none").join(", ")}.`,
    "A non-damaging action with steering is decided automatically and mints no approval envelope.",
    "A non-damaging action with no steering reaches a human only when it has a side effect; an immediate read never escalates.",
    "A tool declared as a proposal is always put to a person, because that is its declared shape.",
  ];
}
