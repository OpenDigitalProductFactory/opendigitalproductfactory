import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ $transaction: vi.fn(), $queryRaw: vi.fn(), scheduledAgentTask: { findUnique: vi.fn(), updateMany: vi.fn() },
  taskRun: { findUnique: vi.fn(), updateMany: vi.fn() }, toolExecution: { findMany: vi.fn() },
  notification: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  communicationDeliveryAttempt: { create: vi.fn(), findMany: vi.fn() }, taskMessage: { create: vi.fn() }, agentMessage: { create: vi.fn() },
  scheduledJob: { updateMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ Prisma: {}, prisma: db, DATA_MODEL_MIRROR_TASK_ID: "data-mirror", SYSML_PROJECTION_TASK_ID: "sysml", SELF_OPTIMIZATION_SWEEP_TASK_ID: "optimization" }));
import { settleScheduledReportingRun, failScheduledReportingRun, runScheduledReportingLoop } from "./scheduled-reporting-run";
import { currentReadEvidencePolicy } from "@/lib/tak/read-evidence-policy";
import { codexReadMcpConfig } from "@/lib/routing/codex-read-mcp";
import { scheduledReportingScopeDigest } from "./scheduled-reporting-contract";

const readTool = { name: "observe_health", description: "Read current health", inputSchema: { type: "object", properties: {} },
  requiredCapability: null, executionMode: "immediate" as const, sideEffect: false };
let task: Record<string, unknown>, run: Record<string, unknown>;
const now = new Date("2026-10-29T03:00:00Z");
const report = (state = "routine", extra = {}) => JSON.stringify({ version: 1, state, summary: "Current measured health.", evidenceToolNames: ["observe_health"], ...extra });
const input = (content = report()) => ({ taskId: String(task.taskId), userId: "owner", taskRunId: "TR-WATCH", threadId: "thread", agentId: "platform-engineer",
  scopeDigest: scheduledReportingScopeDigest(task), content, admittedTools: [readTool], now });
describe("scheduled reporting settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    task = { taskId: "agent-task-56e05d88", ownerUserId: "owner", agentId: "platform-engineer", title: "Health watch", prompt: "Original bounded watch",
      taskRunId: "TR-WATCH", isActive: true, taskKind: null, schedule: "23 */6 * * *", taskConfig: { routineReporting: { version: 1, mode: "read-only-history" } } };
    run = { id: "run-row", taskRunId: "TR-WATCH", userId: "owner", threadId: "thread", contextId: "thread", status: "working", startedAt: new Date(now.getTime() - 5000),
      a2aMetadata: { sourceRef: { kind: "scheduled-task", id: task.taskId }, scheduledReporting: { mode: "read-only-history", scopeDigest: scheduledReportingScopeDigest(task), nextRunAt: null } } };
    db.$transaction.mockImplementation(callback => callback(db));
    db.$queryRaw.mockResolvedValue([{ taskId: task.taskId }]);
    db.scheduledAgentTask.findUnique.mockImplementation(async () => task);
    db.taskRun.findUnique.mockImplementation(async () => run);
    db.scheduledAgentTask.updateMany.mockImplementation(async ({ data }) => { Object.assign(task, data); return { count: 1 }; });
    db.taskRun.updateMany.mockImplementation(async ({ data }) => { Object.assign(run, data); return { count: 1 }; });
    db.toolExecution.findMany.mockResolvedValue([{ id: "observed-read", toolName: "observe_health", success: true, result: { success: true, data: { measured: 7 } } }]);
    db.notification.create.mockResolvedValue({ id: "notice" });
    db.notification.findFirst.mockResolvedValue({ id: "notice" });
    db.notification.updateMany.mockResolvedValue({ count: 1 });
    db.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
    db.communicationDeliveryAttempt.create.mockResolvedValue({ attemptId: "delivery" });
    db.communicationDeliveryAttempt.findMany.mockResolvedValue([{ attemptId: "delivery" }]);
  });
  it("records real observation references in history without creating a routine notice", async () => {
    expect(await settleScheduledReportingRun(input())).toMatchObject({ status: "completed" });
    expect(db.taskMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ evidence: [expect.objectContaining({ toolExecutionId: "observed-read", resultDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })] }) }) }));
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(run.status).toBe("completed");
  });
  it("requires actual fresh successful observations rather than inference or discovery", async () => {
    db.toolExecution.findMany.mockResolvedValue([]);
    await expect(settleScheduledReportingRun(input())).rejects.toThrow();
    expect(db.taskMessage.create).not.toHaveBeenCalled();
    expect(run.status).toBe("working");
  });
  it("cannot turn a failed read into green by listing another successful read", async () => {
    db.toolExecution.findMany.mockResolvedValue([{ id: "failed-read", toolName: "observe_health", success: false, result: { success: false } }]);
    await expect(settleScheduledReportingRun(input())).rejects.toThrow();
    expect(run.status).toBe("working");
  });
  it("records one actionable owner notice and its actual linked delivery before settlement", async () => {
    expect(await settleScheduledReportingRun(input(report("actionable", { recommendation: "Review the measured increase." })))).toMatchObject({ status: "completed" });
    expect(db.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "owner", deepLink: "/api/internal/tasks/TR-WATCH" }) }));
    expect(db.communicationDeliveryAttempt.create).toHaveBeenCalledOnce();
  });
  it("refuses a failed dispatch return instead of recording a successful notification", async () => {
    await expect(settleScheduledReportingRun(input(report("actionable", { recommendation: "Review this." })), {
      dispatch: async () => ({ channel: "in-app", status: "failed" }),
    })).rejects.toThrow();
    expect(db.taskRun.updateMany).not.toHaveBeenCalled();
  });
  it("parks actual judgment before normal recurrence or completion", async () => {
    expect(await settleScheduledReportingRun(input(report("needs-decision", { decisionBrief: "Choose the operating limit for this observed increase." })))).toMatchObject({ status: "input-required" });
    expect(run).toMatchObject({ status: "input-required", completedAt: null });
    expect(run.progressPayload).toMatchObject({ summary: "Current measured health.", decisionBrief: "Choose the operating limit for this observed increase." });
    expect(task).toMatchObject({ lastStatus: "proposed", nextRunAt: null });
  });
  it("uses the server's typed credentials failure, while policy/capability failure stays failed", async () => {
    expect(await settleScheduledReportingRun({ ...input("No model output"), failure: { kind: "credentials", message: "The selected provider requires sign-in." } })).toMatchObject({ status: "auth-required" });
    expect(run).toMatchObject({ status: "auth-required", completedAt: null });
  });
  it("does not infer missing credentials from a policy-or-capability failure", async () => {
    expect(await settleScheduledReportingRun({ ...input("No model output"), failure: { kind: "policy-or-capability", message: "The provider lacks required tool capability." } })).toMatchObject({ status: "failed" });
    expect(run.status).toBe("failed");
    expect(db.notification.create).not.toHaveBeenCalled();
  });
  it("does not let a stale continuation overwrite a parked current run", async () => {
    await settleScheduledReportingRun(input(report("needs-decision", { decisionBrief: "Choose an operating limit." })));
    expect(await failScheduledReportingRun(input(), "A later continuation failed.")).toBe(false);
    expect(run.status).toBe("input-required");
    expect(task.nextRunAt).toBeNull();
  });
  it("carries only reads into native policy and refuses unsupported native transport rather than permitting shell execution", async () => {
    await runScheduledReportingLoop([readTool, { ...readTool, name: "writer", sideEffect: true }], async () => {
      const policy = currentReadEvidencePolicy();
      expect(policy?.toolNames).toEqual([readTool.name]);
      await expect(codexReadMcpConfig({ userId: "owner", agentId: "platform-engineer", taskRunId: "TR-WATCH", readOnlyToolNames: policy?.toolNames }, [], "http://localhost:3000"))
        .rejects.toThrow("Bound native read transport requires");
      return { content: report() };
    });
    expect(currentReadEvidencePolicy()).toBeUndefined();
  });
  it("retains the exact safe validation reason without exposing arbitrary database diagnostics", async () => {
    await failScheduledReportingRun(input(), "A required fresh successful observation is missing.");
    expect(task.lastError).toBe("A required fresh successful observation is missing.");
  });
});
