// What a workroom gate does when it says no (BI-81780B4A, EP-0AF96937).
//
// THE RULE THIS ENCODES. A gate exists to make the right thing happen: proceed
// when the case is clear, escalate when it is ambiguous, refuse when it is
// wrong. A refusal is therefore not one thing — it is three, and collapsing
// them costs in both directions. Treat every no as final and an AI coworker
// stops on something it could have fixed in one move. Treat every no as
// shapeable and it grinds against a stop that was never going to yield, which
// is the forever-loop wearing the costume of diligence.
//
// So every denial a gate can return is classified HERE, once, next to the
// closed vocabulary it classifies:
//
//   shape     the caller can change an input and try again — bounded, and the
//             change must be real (see the retry contract in uncertain-retry.ts)
//   escalate  no input the caller controls will fix it; a person must rule.
//             This is the middle path, and reaching it is a SUCCESS of the
//             gate, not a failure of the coworker
//   hard-no   never yields. A sealed case, an unsupported transition, a tripped
//             stop. AGENTS.md §1: an enforcement refusal is a stop, not a
//             workaround, and shaping against one is the workaround
//
// WHY THE CLASSIFICATION LIVES IN A CLOSED MAP. `WorkCasePolicyDenialReason` is
// a union; this map is keyed by it exhaustively, so adding a reason without
// deciding what kind of no it is does not compile. That is the point: the next
// gate requirement, written by someone who has never read this file, inherits
// the contract by construction rather than by remembering to.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.7

import { getWorkCaseAction } from "./action-registry";
import type { WorkCaseActionVerb } from "./case-types";

/* -------------------------------------------------------------------------- */
/* Disposition                                                                */
/* -------------------------------------------------------------------------- */

export type GateDisposition = "shape" | "escalate" | "hard-no";

/** Every denial a workroom gate can return, and what kind of no it is. */
export type GateDenialReason =
  | "unknown_source"
  | "unknown_action"
  | "unsupported_transition"
  | "terminal_case_sealed"
  | "missing_receipt_policy"
  | "stop_condition_tripped"
  | "missing_decision_interaction"
  | "missing_coworker_envelope"
  | "coworker_envelope_not_approved"
  | "missing_verification_evidence"
  | "missing_accountable_principal"
  | "unresolvable_accountable_principal";

type DenialContract = {
  disposition: GateDisposition;
  /** What the caller must change. Null when nothing they control would help. */
  shapeHint: string | null;
};

/**
 * The classification. Exhaustive by construction: `Record<GateDenialReason, …>`
 * fails to compile when a reason is added without an entry.
 */
export const GATE_DENIAL_CONTRACT: Record<GateDenialReason, DenialContract> = {
  // Malformed requests. Retrying the same call cannot help, and there is no
  // judgement for a person to apply either — the caller named something that
  // does not exist.
  unknown_source: { disposition: "hard-no", shapeHint: null },
  unknown_action: { disposition: "hard-no", shapeHint: null },

  // Structural refusals. The transition is not part of this source's lifecycle,
  // and a sealed case does not reopen because someone asked twice.
  unsupported_transition: { disposition: "hard-no", shapeHint: null },
  terminal_case_sealed: { disposition: "hard-no", shapeHint: null },

  // A tripped stop is a stop (AGENTS.md §1). Shaping against it is the
  // workaround the rule forbids; clearing the condition is a separate act by
  // whoever owns it, not a retry of this action.
  stop_condition_tripped: { disposition: "hard-no", shapeHint: null },

  // Shapeable: the caller holds the missing input and can supply it.
  missing_receipt_policy: {
    disposition: "shape",
    shapeHint: "Attach the receipt policy this action records under, then retry.",
  },
  missing_decision_interaction: {
    disposition: "shape",
    shapeHint: "Run the decision gate for this action and attach its interaction id, then retry.",
  },
  missing_verification_evidence: {
    disposition: "shape",
    shapeHint: "Verify the change and attach the evidence, then retry.",
  },
  missing_coworker_envelope: {
    disposition: "shape",
    shapeHint: "Request a coworker action envelope for this action, then retry.",
  },
  missing_accountable_principal: {
    disposition: "shape",
    shapeHint: "Name the principal accountable for this action, then retry.",
  },
  unresolvable_accountable_principal: {
    disposition: "shape",
    shapeHint: "Use a principal this install can resolve, then retry.",
  },

  // The middle path. An envelope awaiting approval is not something the
  // coworker can shape — a person decides. Retrying would poll a human, which
  // is how a queue of interruptions is built.
  coworker_envelope_not_approved: { disposition: "escalate", shapeHint: null },
};

export function gateDenialContract(reason: string): DenialContract {
  return (
    GATE_DENIAL_CONTRACT[reason as GateDenialReason] ?? {
      // An unclassified reason must never read as shapeable: that is the
      // failure mode where a coworker loops against something nobody scoped.
      disposition: "escalate",
      shapeHint: null,
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Budget                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The shaping budget every gate gets unless its action declares otherwise.
 *
 * Five, on the operator's call (2026-08-25), for both axes:
 *   maxAttempts  how many times a coworker may reshape before the middle path
 *   maxOptions   how many shaped options may be scored against each other
 *
 * Five is a CEILING, not a target. The no-progress trip should end most loops
 * at two or three; a gate that regularly reaches five is telling you its corpus
 * is thin, and that belongs on the review queue as a coverage finding rather
 * than being absorbed as normal cost.
 */
export const GATE_SHAPING_DEFAULT = { maxAttempts: 5, maxOptions: 5 } as const;

export type GateShapingBudget = {
  maxAttempts: number;
  maxOptions: number;
};

/**
 * The budget for one action. Actions may narrow it — never widen it past the
 * platform ceiling, because an action that could grant itself unlimited
 * attempts is an action that can loop forever by declaration.
 */
export function shapingBudgetFor(action: WorkCaseActionVerb): GateShapingBudget {
  const descriptor = getWorkCaseAction(action);
  const declared = descriptor?.shaping;
  return {
    maxAttempts: Math.min(
      declared?.maxAttempts ?? GATE_SHAPING_DEFAULT.maxAttempts,
      GATE_SHAPING_DEFAULT.maxAttempts,
    ),
    maxOptions: Math.min(
      declared?.maxOptions ?? GATE_SHAPING_DEFAULT.maxOptions,
      GATE_SHAPING_DEFAULT.maxOptions,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* The affordance a gate returns                                              */
/* -------------------------------------------------------------------------- */

export type GateShapingAffordance = {
  disposition: GateDisposition;
  /** What to change. Null for escalate and hard-no. */
  shapeHint: string | null;
  /** Attempts still available. 0 once the budget is spent. */
  attemptsRemaining: number;
  /** True when the caller should stop shaping and hand this to a person. */
  escalateNow: boolean;
};

/**
 * What a caller should do about a denial, given how many times it has already
 * tried. The exhaustion path deliberately converts to `escalate` rather than to
 * `hard-no`: running out of attempts says nothing about whether the thing is
 * allowed, only that this coworker could not shape it — and a person deciding
 * is the correct next step, with the attempt history as their context.
 */
export function shapingAffordance(input: {
  action: WorkCaseActionVerb;
  reason: string;
  attemptsSoFar: number;
}): GateShapingAffordance {
  const contract = gateDenialContract(input.reason);
  const budget = shapingBudgetFor(input.action);
  const attemptsRemaining = Math.max(0, budget.maxAttempts - Math.max(0, input.attemptsSoFar));

  if (contract.disposition !== "shape") {
    return {
      disposition: contract.disposition,
      shapeHint: contract.shapeHint,
      attemptsRemaining: 0,
      escalateNow: contract.disposition === "escalate",
    };
  }

  if (attemptsRemaining === 0) {
    return {
      disposition: "escalate",
      shapeHint: contract.shapeHint,
      attemptsRemaining: 0,
      escalateNow: true,
    };
  }

  return {
    disposition: "shape",
    shapeHint: contract.shapeHint,
    attemptsRemaining,
    escalateNow: false,
  };
}
