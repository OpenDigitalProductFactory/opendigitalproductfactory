import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeBookkeepingCycleTask: vi.fn(),
  executeDecisionEngineReviewTask: vi.fn(),
  executeAcceptanceSweepTask: vi.fn(),
}));

vi.mock("@/lib/finance/bookkeeping/bookkeeping-cycle-task", () => ({ executeBookkeepingCycleTask: mocks.executeBookkeepingCycleTask }));
vi.mock("@/lib/decision/self-review/decision-engine-review-task", () => ({ executeDecisionEngineReviewTask: mocks.executeDecisionEngineReviewTask }));
vi.mock("@/lib/backlog/acceptance-sweep/acceptance-sweep-task", () => ({ executeAcceptanceSweepTask: mocks.executeAcceptanceSweepTask }));

import { runDeterministicScheduledTaskKind } from "./agent-task-scheduler-deterministic";

// The scheduler's deterministic branches (AC-S2-1, BI-DF255666): each task kind
// runs its executor with no model call, and any other kind falls through to the
// scheduler's own handling.

const task = (taskKind: string | null) => ({
  taskId: `task-${taskKind}`,
  taskKind,
  schedule: "0 5 * * *",
  ownerUserId: "user-1",
  agentId: "AGT-WS-PORTFOLIO",
});

beforeEach(() => vi.resetAllMocks());

describe("runDeterministicScheduledTaskKind", () => {
  it("runs the acceptance sweep for the acceptance-sweep kind", async () => {
    await expect(runDeterministicScheduledTaskKind(task("acceptance-sweep"))).resolves.toBe(true);
    expect(mocks.executeAcceptanceSweepTask).toHaveBeenCalledWith(task("acceptance-sweep"));
    expect(mocks.executeDecisionEngineReviewTask).not.toHaveBeenCalled();
  });

  it("keeps the decision review and bookkeeping branches", async () => {
    await expect(runDeterministicScheduledTaskKind(task("decision-engine-review"))).resolves.toBe(true);
    expect(mocks.executeDecisionEngineReviewTask).toHaveBeenCalledOnce();
    await expect(runDeterministicScheduledTaskKind(task("bookkeeping-cycle"))).resolves.toBe(true);
    expect(mocks.executeBookkeepingCycleTask).toHaveBeenCalledOnce();
  });

  it("leaves every other task to the scheduler", async () => {
    await expect(runDeterministicScheduledTaskKind(task(null))).resolves.toBe(false);
    await expect(runDeterministicScheduledTaskKind(task("business-analysis-watch"))).resolves.toBe(false);
    expect(mocks.executeAcceptanceSweepTask).not.toHaveBeenCalled();
    expect(mocks.executeBookkeepingCycleTask).not.toHaveBeenCalled();
    expect(mocks.executeDecisionEngineReviewTask).not.toHaveBeenCalled();
  });
});
