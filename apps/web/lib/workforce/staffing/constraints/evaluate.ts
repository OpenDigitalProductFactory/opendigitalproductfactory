/**
 * Constraint engine entry point (EP-WORKFORCE-OPS / BI-4AD09A35 Phase 2).
 * Dispatches each rule to its predicate evaluator and aggregates the result.
 * Deterministic and side-effect-free (spec §7.3, §8.1): hard-rule feasibility is
 * decided here, in DPF, independent of any solver.
 *
 * Fail-closed contract (spec §6, §8.1): when the jurisdiction is unresolved and
 * a safety-critical rule is in scope, the result is flagged
 * `requiresPolicyReview` and the caller must withhold a publishable proposal —
 * the engine never assumes United States defaults for an unresolved location.
 */
import {
  capabilityPresence,
  credentialEligibility,
  maxHoursPremium,
  minNTogether,
  noOverlap,
  pairingRatio,
  restGap,
} from "./predicates";
import type {
  ConstraintRuleInput,
  EvaluationResult,
  NormalizedStaffingProblem,
  PredicateEvaluator,
} from "./types";

/**
 * The predicate registry. Add a §9.8 family by adding one entry — the loop
 * below is closed over this map and needs no change.
 */
export const PREDICATE_REGISTRY: Record<string, PredicateEvaluator> = {
  credential_eligibility: credentialEligibility,
  capability_presence: capabilityPresence,
  min_n_together: minNTogether,
  pairing_ratio: pairingRatio,
  rest_gap: restGap,
  no_overlap: noOverlap,
  max_hours_premium: maxHoursPremium,
};

/**
 * Safety-critical hard-rule families: when the jurisdiction is unresolved these
 * cannot be silently skipped — their presence forces a policy-review verdict
 * rather than a false "feasible" (spec §8.1: unknown means review-required for
 * safety-critical eligibility).
 */
const SAFETY_CRITICAL = new Set([
  "credential_eligibility",
  "capability_presence",
  "min_n_together",
  "pairing_ratio",
]);

function ruleApplies(rule: ConstraintRuleInput, problem: NormalizedStaffingProblem): boolean {
  const region = rule.applicability?.jurisdictionRegion;
  if (region && region !== problem.jurisdiction.region) return false;
  return true;
}

export function evaluateConstraints(
  problem: NormalizedStaffingProblem,
): EvaluationResult {
  const result: EvaluationResult = {
    feasible: true,
    violations: [],
    premiums: [],
    requiresPolicyReview: false,
  };

  const applicable = problem.rules.filter((r) => ruleApplies(r, problem));

  // Fail-closed: an unresolved jurisdiction plus any in-scope safety-critical
  // rule means we cannot certify feasibility — flag for review and stop.
  if (!problem.jurisdiction.resolved) {
    const hasSafetyCritical = applicable.some((r) => SAFETY_CRITICAL.has(r.predicateType));
    if (hasSafetyCritical || applicable.length === 0) {
      result.requiresPolicyReview = true;
      result.feasible = false;
      return result;
    }
  }

  for (const rule of applicable) {
    const evaluator = PREDICATE_REGISTRY[rule.predicateType];
    if (!evaluator) {
      // An unknown predicate on a hard rule cannot be waved through — treat it
      // as review-required rather than silently ignored (spec §8.1).
      if (rule.severity === "hard") {
        result.requiresPolicyReview = true;
        result.feasible = false;
      }
      continue;
    }
    const { violations, premiums } = evaluator(rule, problem);
    if (violations?.length) {
      if (rule.severity === "hard") result.feasible = false;
      result.violations.push(...violations);
    }
    if (premiums?.length) result.premiums.push(...premiums);
  }

  return result;
}
