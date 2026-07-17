/**
 * Coordinator first-viewport view-model (EP-WORKFORCE-OPS / BI-4AD09A35 Phase 6).
 * Spec §15.2: the coordinator starts under time pressure, so the first viewport
 * must surface — for a planning window and team/location scope — coverage
 * status, unscheduled demand, hard conflicts, last-minute changes, and pending
 * decisions. This module is the PURE computation of that view-model from
 * governed staffing data; the React surface (extending `/employee?view=staffing`)
 * renders it and is verified live. Keeping the logic pure means the "what the
 * coordinator sees" contract is unit-tested without the portal.
 *
 * It also enforces the privacy contract (spec §11, §13.4): a coordinator sees
 * minimum-necessary outcomes, never a private calendar-event title — a busy mask
 * is sufficient.
 */
import type { ConstraintViolation } from "../constraints/types";

export type PlanningWindow = { start: string; end: string; timezone: string };

export type DemandRow = {
  demandId: string;
  startAt: string;
  endAt: string;
  workLocationId: string | null;
  minQuantity: number;
  targetQuantity: number | null;
  assignedCount: number;
  status: string;
};

export type ChangeRow = {
  kind: "leave_approved" | "credential_expired" | "demand_changed" | "assignment_withdrawn";
  atAffectedShiftId: string;
  occurredAt: string;
};

export type CoverageStatus = {
  covered: number;
  partial: number;
  uncovered: number;
  /** Fraction of demand fully covered, 0..1 — the single headline number. */
  coverageRate: number;
};

export type CoordinatorViewModel = {
  planningWindow: PlanningWindow;
  locationScope: string | null;
  coverage: CoverageStatus;
  unscheduledDemand: Array<{ demandId: string; shortBy: number; startAt: string }>;
  hardConflicts: Array<{ subjectRef: string; message: string; waivable: boolean }>;
  lastMinuteChanges: ChangeRow[];
  pendingDecisionCount: number;
};

function withinWindow(row: DemandRow, window: PlanningWindow): boolean {
  const s = new Date(window.start).getTime();
  const e = new Date(window.end).getTime();
  const rs = new Date(row.startAt).getTime();
  return rs >= s && rs < e;
}

/**
 * Compose the coordinator view-model. Deterministic and pure: same inputs ⇒ same
 * model. `demand` carries pre-joined assigned counts (the caller does the DB
 * read); `violations` come from the Phase 2 constraint engine; `changes` are the
 * recent hard-fact changes (Phase 7 repair triggers).
 */
export function buildCoordinatorView(input: {
  planningWindow: PlanningWindow;
  locationScope?: string | null;
  demand: DemandRow[];
  violations: ConstraintViolation[];
  changes: ChangeRow[];
  pendingDecisionCount: number;
}): CoordinatorViewModel {
  const scope = input.locationScope ?? null;
  const inScope = input.demand.filter(
    (d) =>
      withinWindow(d, input.planningWindow) &&
      (scope === null || d.workLocationId === scope) &&
      d.status !== "cancelled",
  );

  let covered = 0;
  let partial = 0;
  let uncovered = 0;
  const unscheduledDemand: CoordinatorViewModel["unscheduledDemand"] = [];
  for (const d of inScope) {
    const required = d.targetQuantity ?? d.minQuantity;
    if (d.assignedCount >= required) {
      covered++;
    } else if (d.assignedCount > 0) {
      partial++;
      unscheduledDemand.push({ demandId: d.demandId, shortBy: required - d.assignedCount, startAt: d.startAt });
    } else {
      uncovered++;
      unscheduledDemand.push({ demandId: d.demandId, shortBy: required, startAt: d.startAt });
    }
  }

  const total = inScope.length;
  const coverageRate = total === 0 ? 1 : covered / total;

  // Only hard violations are conflicts the coordinator must resolve; soft
  // premiums belong in the comparison view, not the conflict banner.
  const hardConflicts = input.violations.map((v) => ({
    subjectRef: v.subjectRef,
    message: v.message,
    waivable: v.waivable,
  }));

  // Surface changes affecting in-scope shifts, newest first.
  const lastMinuteChanges = [...input.changes].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return {
    planningWindow: input.planningWindow,
    locationScope: scope,
    coverage: { covered, partial, uncovered, coverageRate },
    unscheduledDemand: unscheduledDemand.sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    ),
    hardConflicts,
    lastMinuteChanges,
    pendingDecisionCount: input.pendingDecisionCount,
  };
}

/**
 * Privacy contract (spec §11, §13.4): a coordinator viewing an employee's
 * free/busy never sees a private event title — the busy mask is sufficient. This
 * helper is the single place that decision is made, so a title cannot leak into
 * a coordinator-facing projection by accident.
 */
export function maskEventForCoordinator(event: {
  title: string;
  startAt: string;
  endAt: string;
  visibility: string;
}): { startAt: string; endAt: string; label: string } {
  const isPrivate = event.visibility !== "public";
  return {
    startAt: event.startAt,
    endAt: event.endAt,
    label: isPrivate ? "Busy" : event.title,
  };
}
