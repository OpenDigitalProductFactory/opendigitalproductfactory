import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  db: { $transaction: vi.fn(), $queryRaw: vi.fn(), scheduledAgentTask: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    scheduledJob: { update: vi.fn(), updateMany: vi.fn() }, agentThread: { upsert: vi.fn() }, agentMessage: { create: vi.fn() },
    user: { findUnique: vi.fn() }, taskRun: { findUnique: vi.fn(), update: vi.fn() }, toolExecution: { findFirst: vi.fn(), findMany: vi.fn() } },
  loop: vi.fn(), tools: vi.fn(), settle: vi.fn(), fail: vi.fn(), createRun: vi.fn(), message: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: m.db, DATA_MODEL_MIRROR_TASK_ID: "mirror", SYSML_PROJECTION_TASK_ID: "sysml", SELF_OPTIMIZATION_SWEEP_TASK_ID: "optimization" }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/actions/agent-task-scheduler-deterministic", () => ({ runDeterministicScheduledTaskKind: vi.fn(async () => false) }));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: m.message }));
vi.mock("@/lib/tak/scheduled-task-runs", async original => ({ ...await original<object>(), createTaskRunForScheduledTask: m.createRun }));
vi.mock("@/lib/tak/autonomous-work-run", () => ({ executeAutonomousAgenticLoop: m.loop, resolveAutonomousWorkTools: m.tools,
  resolveAutonomousWorkAgent: vi.fn(async () => ({ systemPrompt: "Observe", sensitivity: "internal" })), executeAutonomousWorkTool: vi.fn() }));
vi.mock("@/lib/operate/scheduled-jobs/scheduled-reporting-run", async original => ({ ...await original<object>(), settleScheduledReportingRun: m.settle, failScheduledReportingRun: m.fail }));
vi.mock("@/lib/scheduling/scheduled-work-posture.server", () => ({ resolveScheduledTickPlan: vi.fn(async () => ({ plan: { actionBoundary: "act", followUpCadenceMinutes: [1], maxAttempts: 3 } })) }));
vi.mock("@/lib/tak/scheduled-external-access", () => ({ resolveScheduledTurnExternalAccess: vi.fn(async () => ({ enabled: false })), assertScheduledResearchCapability: vi.fn() }));
vi.mock("@dpf/validators/workroom-policy/delegated-posture", () => ({ resolveDelegatedPosture: vi.fn(() => ({})) }));
vi.mock("@/lib/product-management/product-management-playbook-run", () => ({ prepareProductManagementPlaybookRun: vi.fn(), completeProductManagementPlaybookRun: vi.fn() }));
vi.mock("@/lib/work-capsules/workroom-queue-hold", () => ({ holdWorkroomQueueAfterFailure: vi.fn() }));

import { executeScheduledAgentTask } from "./agent-task-scheduler";

let task: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  task = { taskId: "agent-task-test", ownerUserId: "owner", agentId: "observer", title: "Watch", prompt: "Observe. File per-tick evidence.",
    routeContext: "/ops", schedule: "23 */6 * * *", timezone: "UTC", isActive: true, taskKind: null,
    taskConfig: { routineReporting: { version: 1, mode: "read-only-history" } }, nextRunAt: new Date(0), taskRunId: null };
  m.db.$transaction.mockImplementation(async f => f(m.db));
  m.db.$queryRaw.mockResolvedValue([{ taskId: task.taskId }]);
  m.db.scheduledAgentTask.findUnique.mockImplementation(async () => structuredClone(task));
  m.db.scheduledAgentTask.updateMany.mockImplementation(async ({ data }) => { Object.assign(task, data); return { count: 1 }; });
  m.db.scheduledAgentTask.update.mockImplementation(async ({ data }) => { Object.assign(task, data); return structuredClone(task); });
  m.db.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
  m.db.scheduledJob.update.mockResolvedValue({});
  m.db.taskRun.update.mockResolvedValue({});
  m.db.taskRun.findUnique.mockResolvedValue({ status: "working", userId: "owner" });
  m.db.agentMessage.create.mockResolvedValue({});
  m.message.mockResolvedValue({});
  m.db.agentThread.upsert.mockResolvedValue({ id: "thread" });
  m.db.user.findUnique.mockResolvedValue({ id: "owner", isSuperuser: false });
  m.db.toolExecution.findMany.mockResolvedValue([]);
  m.db.toolExecution.findFirst.mockResolvedValue(null);
  m.createRun.mockResolvedValue({ taskRunId: "TR-WATCH", id: "run-row", contextId: "thread" });
  m.tools.mockResolvedValue({ tools: [{ name: "observe", sideEffect: false }], toolsForProvider: [], deferredTools: [] });
  m.loop.mockResolvedValue({ content: '{"version":1,"state":"needs-decision","summary":"New condition","decisionBrief":"Choose the next step","evidenceToolNames":["observe"]}', executedTools: [] });
  m.settle.mockResolvedValue({ status: "input-required", reused: false });
  m.fail.mockResolvedValue(true);
});

describe("history reporting at the real scheduler boundary", () => {
  it.each(["input-required", "auth-required", "completed"])("returns after reporting settlement %s without generic completion or recurrence", async status => {
    m.settle.mockResolvedValue({ status, reused: false });
    await executeScheduledAgentTask(String(task.taskId));
    expect(m.settle).toHaveBeenCalledWith(expect.objectContaining({ taskRunId: "TR-WATCH", userId: "owner", threadId: "thread", admittedTools: expect.any(Array) }));
    expect(m.db.taskRun.update).not.toHaveBeenCalled();
    expect(m.db.scheduledJob.update).not.toHaveBeenCalled();
    expect(m.db.scheduledAgentTask.update.mock.calls.every(([a]) => !a.data.lastStatus)).toBe(true);
    expect(m.loop.mock.calls[0]![0].chatHistory[0].content).toContain("Original task context follows unchanged:\nObserve. File per-tick evidence.");
  });
  it("keeps a real credential outcome and avoids generic short-cadence retry", async () => {
    const failure = { kind: "credentials", message: "Provider sign-in expired." };
    m.loop.mockResolvedValue({ content: "Cannot observe", executedTools: [], failure });
    await executeScheduledAgentTask(String(task.taskId));
    expect(m.settle).toHaveBeenCalledWith(expect.objectContaining({ failure }));
    expect(m.db.taskRun.update).not.toHaveBeenCalled();
    expect(m.db.scheduledAgentTask.update.mock.calls.every(([a]) => !a.data.lastStatus)).toBe(true);
  });
  it("routes invalid reports to the fenced failure path and never falls through to generic writes", async () => {
    m.settle.mockRejectedValue(new Error("Scheduled report must be one JSON object."));
    await executeScheduledAgentTask(String(task.taskId));
    expect(m.fail).toHaveBeenCalledWith(expect.objectContaining({ taskRunId: "TR-WATCH" }), expect.any(String));
    expect(m.db.taskRun.update).not.toHaveBeenCalled();
    expect(m.db.scheduledJob.update).not.toHaveBeenCalled();
  });
  it.each([false, true])("an old ordinary continuation cannot overwrite a newly configured parked watch (failure=%s)", async failure => {
    task.taskConfig = null;
    m.loop.mockImplementation(async () => {
      task.taskConfig = { routineReporting: { version: 1, mode: "read-only-history" } };
      task.isActive = false;
      task.nextRunAt = null;
      task.lastStatus = "proposed";
      if (failure) throw new Error("Old execution failed after the commission changed");
      return { content: "Observed health", executedTools: [{ name: "observe", result: { success: true } }] };
    });
    await executeScheduledAgentTask(String(task.taskId));
    expect(task).toMatchObject({ lastStatus: "proposed", nextRunAt: null, isActive: false });
    expect(m.db.taskRun.update).not.toHaveBeenCalled();
    expect(m.db.scheduledJob.update).not.toHaveBeenCalled();
  });
});
