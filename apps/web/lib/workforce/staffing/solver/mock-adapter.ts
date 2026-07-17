/**
 * Deterministic in-process mock solver (EP-WORKFORCE-OPS / BI-4AD09A35 Phase 3).
 * NOT the production solver — it exists so the adapter contract, the
 * validate-after-solve gate, and the proposal flow can be exercised in fixtures
 * without the Timefold/OR-Tools sidecar (a separate infra spike). A greedy,
 * fully deterministic assignment: stable input ⇒ stable output (spec §15 parity).
 *
 * It intentionally respects only credential eligibility and non-double-booking
 * so tests can also feed it a problem where it is FORCED to leave demand
 * unfilled rather than fabricate an infeasible assignment — proving the honest
 * "no feasible schedule" path (spec §8.3).
 */
import type { NormalizedStaffingProblem } from "../constraints/types";
import type {
  SolveOptions,
  SolverAdapter,
  SolverCandidateAssignment,
  SolverResult,
} from "./adapter";

function credentialValidAt(
  employee: NormalizedStaffingProblem["employees"][number],
  requiredKey: string,
  atMs: number,
): boolean {
  const held = employee.credentials.find((c) => c.key === requiredKey);
  return Boolean(held && (held.expiresAt === null || new Date(held.expiresAt).getTime() >= atMs));
}

function overlaps(
  a: NormalizedStaffingProblem["shifts"][number]["interval"],
  b: NormalizedStaffingProblem["shifts"][number]["interval"],
): boolean {
  const aStart = new Date(a.start.at).getTime();
  const aEnd = new Date(a.end.at).getTime();
  const bStart = new Date(b.start.at).getTime();
  const bEnd = new Date(b.end.at).getTime();
  return aStart < bEnd && bStart < aEnd;
}

export class MockGreedySolver implements SolverAdapter {
  readonly provider = "mock-greedy";
  readonly version = "1.0.0";

  async solve(
    problem: NormalizedStaffingProblem,
    options?: SolveOptions,
  ): Promise<SolverResult> {
    // Deterministic ordering: shifts by start then id, employees by id.
    const shifts = [...problem.shifts].sort(
      (a, b) =>
        new Date(a.interval.start.at).getTime() - new Date(b.interval.start.at).getTime() ||
        a.shiftId.localeCompare(b.shiftId),
    );
    const employees = [...problem.employees].sort((a, b) =>
      a.employeeProfileId.localeCompare(b.employeeProfileId),
    );

    const assignments: SolverCandidateAssignment[] = [];
    const unfilledShiftIds: string[] = [];
    const takenIntervalsByEmployee = new Map<string, typeof shifts[number]["interval"][]>();

    for (const shift of shifts) {
      const startMs = new Date(shift.interval.start.at).getTime();
      const pick = employees.find((e) => {
        const hasCreds = shift.requiredCredentials.every((key) =>
          credentialValidAt(e, key, startMs),
        );
        if (!hasCreds) return false;
        const taken = takenIntervalsByEmployee.get(e.employeeProfileId) ?? [];
        return !taken.some((iv) => overlaps(iv, shift.interval));
      });
      if (!pick) {
        unfilledShiftIds.push(shift.shiftId);
        continue;
      }
      assignments.push({ shiftId: shift.shiftId, employeeProfileId: pick.employeeProfileId });
      const taken = takenIntervalsByEmployee.get(pick.employeeProfileId) ?? [];
      taken.push(shift.interval);
      takenIntervalsByEmployee.set(pick.employeeProfileId, taken);
    }

    const status = unfilledShiftIds.length === 0 ? "feasible" : "infeasible";
    return {
      status,
      options: [
        {
          assignments,
          score: assignments.length,
          unfilledShiftIds,
          hardViolationCount: 0,
        },
      ],
      solverProvider: this.provider,
      solverVersion: this.version,
      timeLimitMs: options?.timeLimitMs ?? null,
    };
  }
}
