import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  taskUpdate: vi.fn(),
  jobUpdate: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { findMany: (...a: unknown[]) => m.findMany(...a) },
    $transaction: async () => true,
    scheduledAgentTask: { update: (...a: unknown[]) => m.taskUpdate(...a) },
    scheduledJob: { update: (...a: unknown[]) => m.jobUpdate(...a) },
  },
}));
vi.mock("@/lib/product-management/product-management-playbook-refresh", () => ({
  queueProductManagementPlaybookRefreshForBacklogItem: (...a: unknown[]) => m.refresh(...a),
}));

import { describeStewardRun, executeDemandScoringStewardTask } from "./scoring-steward-task";

const task = {
  taskId: "demand-scoring-steward-daily",
  schedule: "41 5 * * *",
  agentId: "AGT-WS-PORTFOLIO",
  taskConfig: { batchSize: 10 },
};
const NOW = new Date("2026-10-07T05:41:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.jobUpdate.mockResolvedValue({});
  m.taskUpdate.mockResolvedValue({});
});

describe("describeStewardRun", () => {
  it("says what moved and what is left", () => {
    expect(
      describeStewardRun({ eligible: 9, scored: ["a", "b"], noEffortSignal: ["c"], raced: [], unscoredRemaining: 7 }),
    ).toBe("2 proposed; 7 unscored remaining; 1 need an effort size");
  });
});

describe("executeDemandScoringStewardTask", () => {
  it("records an ok run with its summary and the next daily tick", async () => {
    m.findMany.mockResolvedValue([]);
    await executeDemandScoringStewardTask(task, { now: NOW });
    expect(m.taskUpdate).toHaveBeenCalledWith({
      where: { taskId: task.taskId },
      data: expect.objectContaining({ lastStatus: "ok", lastRunAt: NOW }),
    });
    // Same cron helper the dispatcher uses; within a day of the run, never before it.
    const next = (m.taskUpdate.mock.calls[0]![0] as { data: { nextRunAt: Date } }).data.nextRunAt;
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.getTime() - NOW.getTime()).toBeLessThanOrEqual(24 * 60 * 60_000);
    expect(m.jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastRunSummary: "0 proposed; 0 unscored remaining" }) }),
    );
  });

  it("records an error run instead of throwing when the read fails", async () => {
    m.findMany.mockRejectedValue(new Error("db down"));
    await expect(executeDemandScoringStewardTask(task, { now: NOW })).resolves.toBeUndefined();
    expect(m.taskUpdate).toHaveBeenCalledWith({
      where: { taskId: task.taskId },
      data: expect.objectContaining({ lastStatus: "error", lastError: "db down" }),
    });
  });
});
