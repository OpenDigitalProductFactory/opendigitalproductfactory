// apps/web/lib/explore/phase-gate-disposition.ts
//
// What KIND of no each phase-gate requirement gives when it is unmet
// (BI-09D11444). Split out of build-process-matrix.ts because the module-size
// ratchet rightly refuses to let that file grow further — the same reason
// governed-rejection-disposition.ts sits beside the authority gate rather than
// inside the execute seam.

import type { GateRequirement } from "./build-process-matrix";
import type { OutcomeDisposition } from "@/lib/shared/outcome-disposition";

/**
 * What KIND of no each requirement gives when it is unmet (BI-09D11444).
 *
 * Exhaustive `Record` keyed by the union, exactly as GATE_DENIAL_CONTRACT and
 * GOVERNED_REJECTION_DISPOSITION are: adding a gate requirement without
 * deciding what kind of no it is DOES NOT COMPILE. That is §9's "and for those
 * built in the future" clause, applied one level up from the workroom
 * chokepoint to the gate that governs ideate -> plan -> build -> review -> ship.
 *
 * These are DEFAULTS for the unmet case. A branch may NARROW to a more specific
 * disposition where it knows more — an explicitly failed review is a settled no,
 * not a wait — and checkPhaseGate prefers the branch's own answer.
 */
export const GATE_REQUIREMENT_DISPOSITION: Record<GateRequirement, OutcomeDisposition> = {
  // The author holds the missing artifact and supplies it. Bounded retry.
  "designDoc-present": "awaiting-input",
  "fixContext-complete": "awaiting-input",
  "buildPlan-present": "awaiting-input",
  "verification-typecheck-passed": "awaiting-input",
  "verification-depth-satisfied": "awaiting-input",
  "acceptance-evaluated": "awaiting-input",
  "acceptance-all-met-if-array": "awaiting-input",
  "uxVerification-not-blocking": "awaiting-input",
  "happyPathIntake-ready": "awaiting-input",

  // A reviewer must rule. Nothing the caller supplies substitutes for that, so
  // re-asking polls a person — the retry loop §10 exists to stop.
  "designReview-passed": "awaiting-person",
  "planReview-passed": "awaiting-person",

  // Only ever unmet because a review explicitly FAILED, which is a verdict.
  "designReview-not-failed-if-present": "refused",
};

