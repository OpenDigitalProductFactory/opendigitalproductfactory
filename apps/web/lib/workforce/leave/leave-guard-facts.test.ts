// BI-7BCC87BB (spec D2 S5, AC-LEAVE): a guard-only recommendation leaves no
// DecisionInteraction and, after PR-B, no proposal, so the leave surface
// evaluates the same pure hard guards at read time over current facts. The
// inputs are built by the one function the advisor also uses.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workforce/staffing/staffing-coverage", () => ({
  getStaffingCoverage: vi.fn(async () => ({
    coverage: [{ demandId: "d-1", required: 2, assigned: 2, covered: true, status: "covered" }],
    uncoveredCount: 0,
  })),
}));

import { buildLeaveGuardInputs, evaluateCurrentLeaveGuards } from "./leave-guard-facts";

const row = (requestId: string, over: Record<string, unknown> = {}) => ({
  requestId,
  employeeProfileId: "ep-1",
  departmentId: "dept-1",
  leaveType: "vacation",
  startDate: "2026-08-20T00:00:00.000Z",
  endDate: "2026-08-21T00:00:00.000Z",
  days: 2,
  ...over,
});

describe("buildLeaveGuardInputs", () => {
  it("takes the weakest coverage, net of approved overlap and this request", () => {
    const inputs = buildLeaveGuardInputs({
      request: row("LR-1"),
      organizationId: "org-1",
      remainingBalance: 8,
      approvedOverlap: [{ requestId: "LR-other" }, { requestId: "LR-1" }],
      staffing: { coverage: [{ required: 3, assigned: 6 }, { required: 2, assigned: 3 }] },
      minCoverageCushion: 1,
    });
    expect(inputs).toEqual({
      requestId: "LR-1", leaveType: "vacation", organizationId: "org-1",
      requestedDays: 2, remainingBalance: 8,
      coverage: { requiredHeadcount: 2, coveredIfApproved: 1 },
      minCoverageCushion: 1, maxConsecutiveDays: undefined, requestedConsecutiveDays: 2, inBlackoutWindow: undefined,
    });
  });
});

describe("evaluateCurrentLeaveGuards", () => {
  function db() {
    return {
      organization: { findFirst: vi.fn(async () => ({ id: "org-1" })) },
      leaveBalance: { findMany: vi.fn(async () => [
        { employeeProfileId: "ep-1", leaveType: "vacation", year: 2026, allocated: 1, carriedOver: 0, adjustments: 0, used: 0 },
      ]) },
      leaveRequest: { findMany: vi.fn(async () => []) },
    };
  }

  it("returns the reasons that fire now, per request", async () => {
    const reasons = await evaluateCurrentLeaveGuards([row("LR-1")], db() as never);
    expect(reasons.get("LR-1")).toEqual([
      "Request of 2 day(s) would overdraw the remaining balance of 1.",
      "Approving would breach required coverage (1 covered vs 2 required).",
    ]);
  });

  it("leaves out a request whose guards all pass", async () => {
    const store = db();
    store.leaveBalance.findMany.mockResolvedValue([
      { employeeProfileId: "ep-1", leaveType: "vacation", year: 2026, allocated: 10, carriedOver: 0, adjustments: 0, used: 0 },
    ]);
    const { getStaffingCoverage } = await import("@/lib/workforce/staffing/staffing-coverage");
    vi.mocked(getStaffingCoverage).mockResolvedValueOnce({ coverage: [], uncoveredCount: 0 } as never);
    expect((await evaluateCurrentLeaveGuards([row("LR-1")], store as never)).has("LR-1")).toBe(false);
  });

  it("reads nothing when there is nothing to evaluate, and nothing without an organization", async () => {
    const store = db();
    expect((await evaluateCurrentLeaveGuards([], store as never)).size).toBe(0);
    expect(store.organization.findFirst).not.toHaveBeenCalled();
    store.organization.findFirst.mockResolvedValue(null as never);
    expect((await evaluateCurrentLeaveGuards([row("LR-1")], store as never)).size).toBe(0);
  });
});
