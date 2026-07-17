import { describe, expect, it } from "vitest";
import {
  buildCoordinatorView,
  maskEventForCoordinator,
  type DemandRow,
} from "./coordinator-view";
import type { ConstraintViolation } from "../constraints/types";

// EP-WORKFORCE-OPS / BI-4AD09A35 Phase 6 — the coordinator first-viewport
// view-model (spec §15.2) + the coordinator privacy mask (spec §11, §13.4).

const WINDOW = { start: "2026-08-01T00:00:00Z", end: "2026-08-08T00:00:00Z", timezone: "America/Los_Angeles" };

function demand(id: string, startAt: string, min: number, assigned: number, extra: Partial<DemandRow> = {}): DemandRow {
  return {
    demandId: id,
    startAt,
    endAt: startAt,
    workLocationId: null,
    minQuantity: min,
    targetQuantity: null,
    assignedCount: assigned,
    status: "open",
    ...extra,
  };
}

describe("buildCoordinatorView", () => {
  it("classifies coverage and lists shortfalls, soonest first", () => {
    const view = buildCoordinatorView({
      planningWindow: WINDOW,
      demand: [
        demand("d1", "2026-08-03T10:00:00Z", 2, 2), // covered
        demand("d2", "2026-08-02T10:00:00Z", 3, 1), // partial, short 2
        demand("d3", "2026-08-04T10:00:00Z", 1, 0), // uncovered, short 1
      ],
      violations: [],
      changes: [],
      pendingDecisionCount: 0,
    });
    expect(view.coverage).toMatchObject({ covered: 1, partial: 1, uncovered: 1 });
    expect(view.coverage.coverageRate).toBeCloseTo(1 / 3);
    // sorted by startAt: d2 (Aug 2) before d3 (Aug 4)
    expect(view.unscheduledDemand.map((u) => u.demandId)).toEqual(["d2", "d3"]);
    expect(view.unscheduledDemand[0].shortBy).toBe(2);
  });

  it("excludes out-of-window, out-of-scope, and cancelled demand", () => {
    const view = buildCoordinatorView({
      planningWindow: WINDOW,
      locationScope: "loc-A",
      demand: [
        demand("in", "2026-08-03T10:00:00Z", 1, 0, { workLocationId: "loc-A" }),
        demand("outWindow", "2026-09-03T10:00:00Z", 1, 0, { workLocationId: "loc-A" }),
        demand("outScope", "2026-08-03T10:00:00Z", 1, 0, { workLocationId: "loc-B" }),
        demand("cancelled", "2026-08-03T10:00:00Z", 1, 0, { workLocationId: "loc-A", status: "cancelled" }),
      ],
      violations: [],
      changes: [],
      pendingDecisionCount: 0,
    });
    expect(view.coverage.covered + view.coverage.partial + view.coverage.uncovered).toBe(1);
    expect(view.unscheduledDemand.map((u) => u.demandId)).toEqual(["in"]);
  });

  it("surfaces hard conflicts from constraint violations and counts pending decisions", () => {
    const violations: ConstraintViolation[] = [
      { ruleId: "no-overlap", predicateType: "no_overlap", subjectRef: "e1", message: "overlaps", waivable: false },
    ];
    const view = buildCoordinatorView({
      planningWindow: WINDOW,
      demand: [],
      violations,
      changes: [],
      pendingDecisionCount: 3,
    });
    expect(view.hardConflicts).toHaveLength(1);
    expect(view.hardConflicts[0]).toMatchObject({ subjectRef: "e1", waivable: false });
    expect(view.pendingDecisionCount).toBe(3);
    expect(view.coverage.coverageRate).toBe(1); // no demand ⇒ nothing uncovered
  });

  it("orders last-minute changes newest first", () => {
    const view = buildCoordinatorView({
      planningWindow: WINDOW,
      demand: [],
      violations: [],
      changes: [
        { kind: "leave_approved", atAffectedShiftId: "s1", occurredAt: "2026-08-01T09:00:00Z" },
        { kind: "credential_expired", atAffectedShiftId: "s2", occurredAt: "2026-08-01T15:00:00Z" },
      ],
      pendingDecisionCount: 0,
    });
    expect(view.lastMinuteChanges.map((c) => c.kind)).toEqual(["credential_expired", "leave_approved"]);
  });
});

describe("maskEventForCoordinator (privacy — spec §13.4)", () => {
  it("masks a private event title to Busy", () => {
    const masked = maskEventForCoordinator({ title: "Therapy appointment", startAt: "a", endAt: "b", visibility: "private" });
    expect(masked.label).toBe("Busy");
  });

  it("shows a public event title", () => {
    const masked = maskEventForCoordinator({ title: "All-hands", startAt: "a", endAt: "b", visibility: "public" });
    expect(masked.label).toBe("All-hands");
  });

  it("defaults to masking any non-public visibility (team, personal)", () => {
    for (const visibility of ["team", "personal", "confidential"]) {
      expect(maskEventForCoordinator({ title: "secret", startAt: "a", endAt: "b", visibility }).label).toBe("Busy");
    }
  });
});
