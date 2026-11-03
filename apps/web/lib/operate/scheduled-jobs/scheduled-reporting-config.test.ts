import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn(), transaction: vi.fn() }));
vi.mock("@dpf/db", () => ({ Prisma: {}, prisma: { scheduledAgentTask: db, $transaction: db.transaction },
  DATA_MODEL_MIRROR_TASK_ID: "data-mirror", SYSML_PROJECTION_TASK_ID: "sysml", SELF_OPTIMIZATION_SWEEP_TASK_ID: "optimization" }));
import { configureScheduledReportingFor, preflightConfigureScheduledReporting } from "./scheduled-reporting-config";
import { scheduledReportingRevision } from "./scheduled-reporting-contract";

const original = { taskId: "agent-task-56e05d88", ownerUserId: "owner", agentId: "platform-engineer", title: "Observe",
  prompt: "Original private commission and limits stay byte for byte.", routeContext: "/platform", schedule: "23 */6 * * *",
  timezone: "UTC", isActive: false, taskKind: null, taskConfig: { trigger: { kind: "time", recordedAt: "2026-10-01T00:00:00Z" } },
  organizationId: null, productLineId: null, businessProductId: null, updatedAt: new Date("2026-10-29T00:00:00Z"), taskRunId: "older-run" };
let task = structuredClone(original);
const input = () => ({ taskId: task.taskId, expectedRevision: scheduledReportingRevision(task), mode: "read-only-history", reason: "Owner chose history and actionable changes." });

describe("exact owner scheduled reporting configuration", () => {
  beforeEach(() => {
    task = structuredClone(original);
    vi.clearAllMocks();
    db.findUnique.mockImplementation(async () => structuredClone(task));
    db.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.ownerUserId !== task.ownerUserId || where.isActive !== task.isActive || where.updatedAt.getTime() !== task.updatedAt.getTime()) return { count: 0 };
      task = { ...task, ...data, updatedAt: new Date(task.updatedAt.getTime() + 1) };
      return { count: 1 };
    });
    db.transaction.mockImplementation(async callback => callback({ scheduledAgentTask: db, $queryRaw: async () => [{ taskId: task.taskId }] }));
  });

  it("merges only the versioned reporting key, leaving the same paused job, prompt, cadence and history intact", async () => {
    const before = structuredClone(task);
    const result = await configureScheduledReportingFor("owner", input());
    expect(result.success).toBe(true);
    expect(task).toEqual({ ...before, updatedAt: expect.any(Date), taskConfig: { ...before.taskConfig, routineReporting: { version: 1, mode: "read-only-history" } } });
    expect(db.updateMany.mock.calls[0]![0].data).toEqual({ taskConfig: task.taskConfig });
    expect(JSON.stringify(result)).not.toContain(before.prompt);
  });
  it("checks exact owner and eligibility before an approval can be offered", async () => {
    expect(await preflightConfigureScheduledReporting(input(), "foreign-owner")).toMatchObject({ success: false });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    task.isActive = true;
    expect(await preflightConfigureScheduledReporting(input(), "owner")).toMatchObject({ success: false });
  });
  it("rechecks current revision and ownership in the write transaction", async () => {
    const args = input();
    expect(await preflightConfigureScheduledReporting(args, "owner")).toBeNull();
    task.prompt += " intervening revision";
    expect(await configureScheduledReportingFor("owner", args)).toMatchObject({ success: false });
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it("refuses an intervening row update at compare-and-swap rather than overwriting it", async () => {
    db.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await configureScheduledReportingFor("owner", input())).toMatchObject({ success: false });
    expect(task).toEqual(original);
  });
  it.each([
    { mode: "act" }, { expectedRevision: "guessed" }, { taskConfig: { grants: ["admin"] } },
    { schedule: "* * * * *" }, { isActive: true }, { prompt: "replace the original" },
  ])("rejects caller expansion %j without touching the job", async change => {
    expect(await configureScheduledReportingFor("owner", { ...input(), ...change })).toMatchObject({ success: false });
    expect(db.updateMany).not.toHaveBeenCalled();
  });
});
