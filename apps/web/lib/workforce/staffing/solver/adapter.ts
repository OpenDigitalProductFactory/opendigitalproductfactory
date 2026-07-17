/**
 * Provider-neutral staffing solver adapter (EP-WORKFORCE-OPS / BI-4AD09A35
 * Phase 3). Spec §7.3 — the solver boundary. The adapter accepts a NORMALIZED,
 * versioned problem and returns candidate solutions plus machine-readable score
 * and violation detail. It has NO authority: it cannot read the database, send
 * notifications, publish shifts, or decide exceptions. Identity resolution,
 * rule applicability, authorization, persistence, and the independent hard-rule
 * validation-after-solve all happen in DPF, outside the solver.
 *
 * The kernel selected Timefold as the first stack to validate in the packaging
 * spike (DI-78788D22BE65); OR-Tools CP-SAT is the documented fallback. Both map
 * to THIS contract — provider enums must never leak into the core model (spec
 * §14.1). The Timefold/OR-Tools sidecar is a separate infrastructure spike; this
 * module is the pure contract plus a deterministic in-process mock used for
 * fixtures and post-solve-validation tests.
 */
import type { NormalizedStaffingProblem } from "../constraints/types";

/**
 * Terminal solve status. Mirrors the CP-SAT status model (spec §7.3) and the
 * StaffingProposalRun.status lifecycle so persistence is a direct mapping.
 */
export type SolveStatus =
  | "optimal"
  | "feasible"
  | "infeasible"
  | "unknown"
  | "timeout"
  | "error";

export type SolveOptions = {
  /** Wall-clock budget; the adapter must return a terminal status by then. */
  timeLimitMs?: number;
  /** Cap on the number of distinct candidate options returned (spec §8.3: 2–4). */
  maxOptions?: number;
  /** Determinism seed — same seed + same input ⇒ same output (spec §15 parity). */
  seed?: number;
};

/** One proposed person↔shift binding within a candidate option. */
export type SolverCandidateAssignment = {
  shiftId: string;
  employeeProfileId: string;
};

/** A single candidate schedule the solver returns. Never persisted as-is until
 *  DPF has re-validated it (see validate-after-solve). */
export type SolverOption = {
  assignments: SolverCandidateAssignment[];
  /** Decomposable objective score in solver-native units (spec §8.2). */
  score: number;
  /** Shift ids the option could not fill — surfaced honestly, never faked. */
  unfilledShiftIds: string[];
  /** The solver's own count of hard-rule violations it could not avoid. */
  hardViolationCount: number;
};

export type SolverResult = {
  status: SolveStatus;
  options: SolverOption[];
  solverProvider: string;
  solverVersion: string;
  timeLimitMs: number | null;
};

/**
 * The adapter contract. A single method that maps a normalized problem to
 * candidate solutions. Deliberately pure: input in, result out, no side effects.
 */
export interface SolverAdapter {
  readonly provider: string;
  readonly version: string;
  solve(problem: NormalizedStaffingProblem, options?: SolveOptions): Promise<SolverResult>;
}
