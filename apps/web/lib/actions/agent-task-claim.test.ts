import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimScheduledTaskCadence, withCurrentScheduledTask } from "./agent-task-claim";

let task: Record<string, unknown>;
const tx = { $queryRaw: vi.fn(), scheduledAgentTask: { findUnique: vi.fn(), updateMany: vi.fn() }, scheduledJob: { updateMany: vi.fn() }, taskRun: { findUnique: vi.fn() } };
const db = { ...tx, $transaction: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  task = { taskId: "job", ownerUserId: "owner", prompt: "Observe", title: "Watch", schedule: "0 * * * *", isActive: true, taskConfig: null, taskRunId: "TR-1" };
  tx.$queryRaw.mockResolvedValue([{ taskId: "job" }]);
  tx.scheduledAgentTask.findUnique.mockImplementation(async () => structuredClone(task));
  tx.taskRun.findUnique.mockResolvedValue({ status: "working", userId: "owner" });
  db.$transaction.mockImplementation(async f => f(tx));
  tx.scheduledAgentTask.updateMany.mockResolvedValue({ count: 1 });
  tx.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
});

describe("current scheduled settlement fence", () => {
  const settle = (original: Record<string, unknown>, write = vi.fn(async () => "settled")) =>
    withCurrentScheduledTask(db as never, original, "TR-1", write, true).then(result => ({ result, write }));
  it("runs ordinary settlement inside the same owner-row transaction", async () => {
    const { result, write } = await settle(structuredClone(task));
    expect(result).toBe("settled");
    expect(write).toHaveBeenCalledWith(tx);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
  });
  it.each(["mode", "prompt", "paused", "new-run", "parked", "rerun"])("prevents a stale ordinary writer after %s changed", async change => {
    const original = structuredClone(task);
    if (change === "mode") task.taskConfig = { routineReporting: { version: 1, mode: "read-only-history" } };
    if (change === "prompt") task.prompt = "A different commission";
    if (change === "paused") task.isActive = false;
    if (change === "new-run") task.taskRunId = "TR-2";
    if (change === "parked") tx.taskRun.findUnique.mockResolvedValue({ status: "input-required", userId: "owner" });
    if (change === "rerun") task.nextRunAt = new Date();
    const { result, write } = await settle(original);
    expect(result).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });
  it("does not treat the normal one-shot cadence deactivation as changed scope", async () => {
    task.schedule = "0 9 1 11 *";
    const original = structuredClone(task);
    task.isActive = false;
    expect((await settle(original)).result).toBe("settled");
  });
  it("refuses a stale cadence claim before either recurrence projection is written", async () => {
    const original = structuredClone(task);
    task.isActive = false;
    task.taskConfig = { routineReporting: { version: 1, mode: "read-only-history" } };
    expect(await claimScheduledTaskCadence(db as never, original as never)).toBe(false);
    expect(tx.scheduledJob.updateMany).not.toHaveBeenCalled();
  });
});
