/**
 * Constraint predicate evaluators (EP-WORKFORCE-OPS / BI-4AD09A35 Phase 2).
 * Each evaluator is pure and deterministic (spec §8.1). This is the load-bearing
 * subset for the first golden model (appointment coverage + field crew); the
 * registry in `evaluate.ts` is designed so the remaining §9.8 families are added
 * as sibling evaluators without touching the loop.
 *
 * Convention: "unknown is not automatically false" (spec §8.1). For
 * safety-critical eligibility (credentials) unknown means a violation/review;
 * for a soft premium unknown means no contribution.
 */
import type {
  AssignmentInput,
  ConstraintRuleInput,
  ConstraintViolation,
  NormalizedStaffingProblem,
  PredicateEvaluator,
  ShiftInput,
} from "./types";

const HOUR_MS = 3_600_000;

function hoursBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / HOUR_MS;
}

function shiftById(problem: NormalizedStaffingProblem, shiftId: string): ShiftInput | undefined {
  return problem.shifts.find((s) => s.shiftId === shiftId);
}

/** Confirmed/published assignments are the ones that bind hard rules. */
function bindingAssignments(problem: NormalizedStaffingProblem): AssignmentInput[] {
  return problem.assignments.filter(
    (a) => a.lifecycle === "confirmed" || a.lifecycle === "completed",
  );
}

function violation(
  rule: ConstraintRuleInput,
  subjectRef: string,
  message: string,
): ConstraintViolation {
  return {
    ruleId: rule.ruleId,
    predicateType: rule.predicateType,
    subjectRef,
    message,
    waivable: rule.legallyWaivable,
    sourcePolicyUrl: rule.sourcePolicyUrl ?? null,
  };
}

/**
 * credential_eligibility — every assignee holds each credential the shift
 * requires, unexpired at the shift start. Expiry auto-de-eligibles (spec §9.3);
 * a missing/unknown credential is a violation because credential eligibility is
 * safety-critical (spec §8.1).
 */
export const credentialEligibility: PredicateEvaluator = (rule, problem) => {
  const violations: ConstraintViolation[] = [];
  for (const assignment of bindingAssignments(problem)) {
    const shift = shiftById(problem, assignment.shiftId);
    const employee = problem.employees.find(
      (e) => e.employeeProfileId === assignment.employeeProfileId,
    );
    if (!shift || !employee) continue;
    const startMs = new Date(shift.interval.start.at).getTime();
    for (const required of shift.requiredCredentials) {
      const held = employee.credentials.find((c) => c.key === required);
      const validAtStart =
        held && (held.expiresAt === null || new Date(held.expiresAt).getTime() >= startMs);
      if (!validAtStart) {
        violations.push(
          violation(
            rule,
            assignment.assignmentId,
            `assignee lacks a valid "${required}" credential at shift start`,
          ),
        );
      }
    }
  }
  return { violations };
};

/**
 * capability_presence — a named-capability holder must be present on the shift
 * (spec §9.3): DEA key-holder, supervising clinician, competent person, etc.
 * `parameters.capability` names the required capability.
 */
export const capabilityPresence: PredicateEvaluator = (rule, problem) => {
  const capability = String(rule.parameters.capability ?? "");
  const violations: ConstraintViolation[] = [];
  const byShift = groupAssigneesByShift(problem);
  for (const shift of problem.shifts) {
    const assignees = byShift.get(shift.shiftId) ?? [];
    const present = assignees.some((e) => e.capabilities.includes(capability));
    if (assignees.length > 0 && !present) {
      violations.push(
        violation(rule, shift.shiftId, `no assignee with capability "${capability}" is present`),
      );
    }
  }
  return { violations };
};

/**
 * min_n_together — at least N assignees holding a capability must be
 * simultaneously present on a shift (spec §9.3): banking dual control, UL 827
 * operator minimums, two-person rules. `parameters.capability`, `parameters.n`.
 */
export const minNTogether: PredicateEvaluator = (rule, problem) => {
  const capability = String(rule.parameters.capability ?? "");
  const n = Number(rule.parameters.n ?? 2);
  const violations: ConstraintViolation[] = [];
  const byShift = groupAssigneesByShift(problem);
  for (const shift of problem.shifts) {
    const assignees = byShift.get(shift.shiftId) ?? [];
    if (assignees.length === 0) continue;
    const count = assignees.filter((e) => e.capabilities.includes(capability)).length;
    if (count < n) {
      violations.push(
        violation(
          rule,
          shift.shiftId,
          `needs ${n} present with "${capability}"; found ${count}`,
        ),
      );
    }
  }
  return { violations };
};

/**
 * pairing_ratio — a supervised role's headcount may not exceed a ratio of the
 * supervising role's headcount on a shift (spec §9.3): apprentice:journeyman
 * ratios. `parameters.supervisedRole`, `parameters.supervisorRole`,
 * `parameters.maxPerSupervisor`.
 */
export const pairingRatio: PredicateEvaluator = (rule, problem) => {
  const supervised = String(rule.parameters.supervisedRole ?? "");
  const supervisor = String(rule.parameters.supervisorRole ?? "");
  const maxPer = Number(rule.parameters.maxPerSupervisor ?? 1);
  const violations: ConstraintViolation[] = [];
  const byShift = groupAssigneesByShift(problem);
  for (const shift of problem.shifts) {
    const assignees = byShift.get(shift.shiftId) ?? [];
    const supervisors = assignees.filter((e) => e.roleKey === supervisor).length;
    const supervisedCount = assignees.filter((e) => e.roleKey === supervised).length;
    if (supervisedCount > 0 && supervisedCount > supervisors * maxPer) {
      violations.push(
        violation(
          rule,
          shift.shiftId,
          `${supervisedCount} ${supervised} exceed ${maxPer}×${supervisors} ${supervisor}`,
        ),
      );
    }
  }
  return { violations };
};

/**
 * rest_gap — an employee's consecutive shifts must be separated by at least the
 * configured turnaround (spec §9.4: clopening / IATSE turnaround). Uses instants
 * so DST is handled by the underlying UTC arithmetic. `parameters.minHours`.
 */
export const restGap: PredicateEvaluator = (rule, problem) => {
  const minHours = Number(rule.parameters.minHours ?? 10);
  const violations: ConstraintViolation[] = [];
  for (const employee of problem.employees) {
    const intervals = employeeIntervals(problem, employee.employeeProfileId).sort(
      (a, b) => new Date(a.start.at).getTime() - new Date(b.start.at).getTime(),
    );
    for (let i = 1; i < intervals.length; i++) {
      const gap = hoursBetween(intervals[i - 1].end.at, intervals[i].start.at);
      if (gap < minHours) {
        violations.push(
          violation(
            rule,
            employee.employeeProfileId,
            `rest gap ${gap.toFixed(1)}h < required ${minHours}h`,
          ),
        );
      }
    }
  }
  return { violations };
};

/**
 * no_overlap — an employee cannot hold two overlapping binding assignments
 * (spec §5.3). This invariant is unconditional; a typed operating model that
 * permits overlap would carry an explicit exception, not silence.
 */
export const noOverlap: PredicateEvaluator = (rule, problem) => {
  const violations: ConstraintViolation[] = [];
  for (const employee of problem.employees) {
    const intervals = employeeIntervals(problem, employee.employeeProfileId).sort(
      (a, b) => new Date(a.start.at).getTime() - new Date(b.start.at).getTime(),
    );
    for (let i = 1; i < intervals.length; i++) {
      const prevEnd = new Date(intervals[i - 1].end.at).getTime();
      const curStart = new Date(intervals[i].start.at).getTime();
      if (curStart < prevEnd) {
        violations.push(
          violation(
            rule,
            employee.employeeProfileId,
            "holds overlapping confirmed assignments",
          ),
        );
      }
    }
  }
  return { violations };
};

/**
 * max_hours_premium — a SOFT, priced schedule-shape cost (spec §9.4): hours an
 * employee works beyond a threshold in the problem window accrue premium units,
 * rather than making the schedule infeasible. `parameters.thresholdHours`,
 * `parameters.premiumPerHour`.
 */
export const maxHoursPremium: PredicateEvaluator = (rule, problem) => {
  const threshold = Number(rule.parameters.thresholdHours ?? 40);
  const premiumPerHour = Number(rule.parameters.premiumPerHour ?? 0.5);
  const premiums = [];
  for (const employee of problem.employees) {
    const total = employeeIntervals(problem, employee.employeeProfileId).reduce(
      (sum, iv) => sum + hoursBetween(iv.start.at, iv.end.at),
      0,
    );
    if (total > threshold) {
      premiums.push({
        ruleId: rule.ruleId,
        predicateType: rule.predicateType,
        subjectRef: employee.employeeProfileId,
        units: (total - threshold) * premiumPerHour,
        message: `${(total - threshold).toFixed(1)}h over ${threshold}h threshold`,
      });
    }
  }
  return { premiums };
};

/**
 * clopening_premium — a SOFT, priced cost (spec §9.4) for a short turnaround
 * between an employee's consecutive shifts: the payable "clopening" premium that
 * fair-workweek laws attach (e.g. NYC $100, Chicago 1.25×). Distinct from the
 * HARD `rest_gap`: some jurisdictions forbid a short gap outright (hard), others
 * merely price it (this). `parameters.minHours`, `parameters.premiumUnits`.
 */
export const clopeningPremium: PredicateEvaluator = (rule, problem) => {
  const minHours = Number(rule.parameters.minHours ?? 11);
  const premiumUnits = Number(rule.parameters.premiumUnits ?? 1);
  const premiums = [];
  for (const employee of problem.employees) {
    const intervals = employeeIntervals(problem, employee.employeeProfileId).sort(
      (a, b) => new Date(a.start.at).getTime() - new Date(b.start.at).getTime(),
    );
    for (let i = 1; i < intervals.length; i++) {
      const gap = hoursBetween(intervals[i - 1].end.at, intervals[i].start.at);
      if (gap < minHours) {
        premiums.push({
          ruleId: rule.ruleId,
          predicateType: rule.predicateType,
          subjectRef: employee.employeeProfileId,
          units: premiumUnits,
          message: `clopening premium: ${gap.toFixed(1)}h turnaround < ${minHours}h`,
        });
      }
    }
  }
  return { premiums };
};

/**
 * max_consecutive_days — HARD: an employee may not work more than N consecutive
 * calendar days (spec §9.4 fatigue / day-of-rest rules, e.g. IL ODRISA one-day-
 * rest-in-seven). Day is the UTC date of the shift start — a documented
 * approximation; the effective-dated pack refines to the decision timezone.
 * `parameters.maxDays`.
 */
export const maxConsecutiveDays: PredicateEvaluator = (rule, problem) => {
  const maxDays = Number(rule.parameters.maxDays ?? 6);
  const violations: ConstraintViolation[] = [];
  for (const employee of problem.employees) {
    const days = Array.from(
      new Set(
        employeeIntervals(problem, employee.employeeProfileId).map((iv) =>
          iv.start.at.slice(0, 10),
        ),
      ),
    ).sort();
    let run = days.length > 0 ? 1 : 0;
    let longest = run;
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(`${days[i - 1]}T00:00:00Z`).getTime();
      const cur = new Date(`${days[i]}T00:00:00Z`).getTime();
      run = cur - prev === 86_400_000 ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    if (longest > maxDays) {
      violations.push(
        violation(
          rule,
          employee.employeeProfileId,
          `${longest} consecutive days worked > max ${maxDays}`,
        ),
      );
    }
  }
  return { violations };
};

// ── helpers ──────────────────────────────────────────────────────────────────

function groupAssigneesByShift(problem: NormalizedStaffingProblem) {
  const map = new Map<string, NormalizedStaffingProblem["employees"]>();
  for (const assignment of bindingAssignments(problem)) {
    const employee = problem.employees.find(
      (e) => e.employeeProfileId === assignment.employeeProfileId,
    );
    if (!employee) continue;
    const list = map.get(assignment.shiftId) ?? [];
    list.push(employee);
    map.set(assignment.shiftId, list);
  }
  return map;
}

function employeeIntervals(problem: NormalizedStaffingProblem, employeeProfileId: string) {
  const intervals: ShiftInput["interval"][] = [];
  for (const assignment of bindingAssignments(problem)) {
    if (assignment.employeeProfileId !== employeeProfileId) continue;
    const shift = shiftById(problem, assignment.shiftId);
    if (shift) intervals.push(shift.interval);
  }
  return intervals;
}
