/**
 * Independent post-solve validation (EP-WORKFORCE-OPS / BI-4AD09A35 Phase 3).
 * Spec §7.3 + §15.3: after a solver returns candidate options, DPF re-runs its
 * own deterministic hard-rule engine over the proposed assignments. The solver
 * is UNTRUSTED — "the solver recommended it" is not a defensible rationale
 * (spec §14.3). An option is only publishable if DPF's own engine agrees it is
 * feasible; a hard violation the solver missed (or introduced) is caught here.
 */
import { evaluateConstraints } from "../constraints/evaluate";
import type {
  EvaluationResult,
  NormalizedStaffingProblem,
} from "../constraints/types";
import type { SolverOption } from "./adapter";

export type ValidatedOption = {
  option: SolverOption;
  evaluation: EvaluationResult;
  /** True only when DPF's own engine certifies the option (no hard violations,
   *  no policy-review gap) — the gate for offering the option for approval. */
  publishable: boolean;
};

/**
 * Re-evaluate one solver option against the problem's rules by treating its
 * proposed bindings as confirmed assignments and running the DPF constraint
 * engine. Returns DPF's verdict, independent of the solver's self-report.
 */
export function validateSolverOption(
  problem: NormalizedStaffingProblem,
  option: SolverOption,
): ValidatedOption {
  const problemWithOption: NormalizedStaffingProblem = {
    ...problem,
    assignments: option.assignments.map((a, i) => ({
      assignmentId: `proposed-${i}`,
      shiftId: a.shiftId,
      employeeProfileId: a.employeeProfileId,
      lifecycle: "confirmed",
    })),
  };
  const evaluation = evaluateConstraints(problemWithOption);
  return {
    option,
    evaluation,
    publishable: evaluation.feasible && !evaluation.requiresPolicyReview,
  };
}

/** Validate every option a solver returned; callers offer only publishable ones. */
export function validateSolverResult(
  problem: NormalizedStaffingProblem,
  options: SolverOption[],
): ValidatedOption[] {
  return options.map((option) => validateSolverOption(problem, option));
}
