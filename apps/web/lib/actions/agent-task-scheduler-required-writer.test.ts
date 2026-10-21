// BI-62DB6C03 — the scheduler wiring for a Workroom stage's evidence writer:
// not dispatched without it, corrected once when it was offered and not called.
// Same mock harness as agent-task-scheduler-proactivity.test.ts (vitest mock
// harnesses are per-file).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    scheduledAgentTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    scheduledJob: {
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    agentThread: {
      upsert: vi.fn(),
    },
    agentMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    userFact: { findMany: vi.fn() },
    taskRun: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    taskMessage: {
      create: vi.fn(),
    },
    toolExecution: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    marketingCampaignBrief: {
      findFirst: vi.fn(),
    },
  },
  resolveAgentForRouteWithPrompts: vi.fn(),
  resolveAgentByIdWithPrompts: vi.fn(),
  runAgenticLoop: vi.fn(),
  getAvailableTools: vi.fn(),
  toolsToOpenAIFormat: vi.fn(),
  executeTool: vi.fn(),
  governedExecuteTool: vi.fn(),
  runArchitectureParitySteward: vi.fn(),
  runConsolidationParitySteward: vi.fn(),
  runSelfOptimizationSweep: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: mocks.prisma,
  DATA_MODEL_MIRROR_TASK_ID: "data-model-mirror-nightly",
  SYSML_PROJECTION_TASK_ID: "sysml-projection-nightly",
  SELF_OPTIMIZATION_SWEEP_TASK_ID: "self-optimization-sweep-weekly",
}));
vi.mock("@/lib/tak/agent-routing-server", () => ({
  resolveAgentForRouteWithPrompts: mocks.resolveAgentForRouteWithPrompts,
  resolveAgentByIdWithPrompts: mocks.resolveAgentByIdWithPrompts,
}));
vi.mock("@/lib/tak/agentic-loop", () => ({
  runAgenticLoop: mocks.runAgenticLoop,
}));
vi.mock("@/lib/mcp-tools", () => ({
  getAvailableTools: mocks.getAvailableTools,
  toolsToOpenAIFormat: mocks.toolsToOpenAIFormat,
  executeTool: mocks.executeTool,
}));
vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: mocks.governedExecuteTool,
}));
vi.mock("@/lib/ea/architecture-parity-steward", () => ({
  runArchitectureParitySteward: mocks.runArchitectureParitySteward,
}));
vi.mock("@/lib/ea/consolidation-parity-steward", () => ({
  runConsolidationParitySteward: mocks.runConsolidationParitySteward,
}));
vi.mock("@/lib/optimization/self-optimization-sweep", () => ({
  runSelfOptimizationSweep: mocks.runSelfOptimizationSweep,
}));

import { executeScheduledAgentTask } from "./agent-task-scheduler";

const FIXED_NOW = new Date("2026-07-12T09:00:00.000Z");
const ROUTE = "/ops/workrooms";
const TASK_ID = "workroom-WC-0A92C30D-adopter-health-watch";
const BRIEF = `You are executing one stage of a standing Workroom activity.
Room: WC-0A92C30D
Tools for this stage: list_customer_accounts.
Before you finish, record what you did by calling record_workroom_evidence with capsuleId "WC-0A92C30D", stageKey "report", kind "assurance-finding", and outcome "completed".`;
const READER = { name: "list_customer_accounts", description: "List accounts", inputSchema: {}, requiredCapability: null, executionMode: "immediate", sideEffect: false };
const WRITER = { name: "record_workroom_evidence", description: "Append evidence", inputSchema: {}, requiredCapability: "manage_backlog", executionMode: "immediate", sideEffect: true };
const UNAVAILABLE = "Status: blocked. I read all 5 accounts, but the required evidence-recording action is unavailable.";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) => callback(mocks.prisma));
  mocks.prisma.scheduledAgentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
    taskId: TASK_ID, agentId: "customer-advisor", title: "Workroom WC-0A92C30D / report", prompt: BRIEF,
    routeContext: ROUTE, schedule: "47 13 * * *", timezone: "UTC", isActive: true, ownerUserId: "user-1", attempts: 0,
    taskConfig: { workroomStage: { shapeKey: "adopter-health-watch", shapeVersion: "1.0.0", stageKey: "report", tools: ["list_customer_accounts"] } },
  });
  mocks.prisma.agentThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.agentMessage.findMany.mockResolvedValue([]);
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "user-1", isSuperuser: true });
  mocks.prisma.userFact.findMany.mockResolvedValue([]);
  const agent = { agentId: "customer-advisor", agentName: "Customer Advisor", agentDescription: "x", canAssist: true, systemPrompt: "You are the customer advisor.", sensitivity: "internal", skills: [] };
  mocks.resolveAgentForRouteWithPrompts.mockResolvedValue(agent);
  mocks.resolveAgentByIdWithPrompts.mockResolvedValue(agent);
  mocks.getAvailableTools.mockResolvedValue([READER, WRITER]);
  mocks.toolsToOpenAIFormat.mockReturnValue([]);
  mocks.prisma.taskRun.create.mockResolvedValue({ id: "task-run-row-1", taskRunId: "TR-SCHED-WRITER1", contextId: "thread-1" });
  mocks.prisma.taskMessage.create.mockResolvedValue({});
  mocks.prisma.taskRun.update.mockResolvedValue({});
  mocks.prisma.toolExecution.findFirst.mockResolvedValue(null);
  mocks.prisma.toolExecution.findMany.mockResolvedValue([]);
  mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
  mocks.prisma.scheduledJob.update.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

function recordedTask(): { lastStatus?: string; lastError?: string | null } {
  const calls = mocks.prisma.scheduledAgentTask.update.mock.calls;
  return calls[calls.length - 1]?.[0]?.data ?? {};
}

describe("a Workroom stage run and its evidence writer (BI-62DB6C03)", () => {
  it("is not dispatched in advise mode, where the writer is withheld", async () => {
    mocks.prisma.userFact.findMany.mockResolvedValue([{
      id: "fact-quiet-1",
      key: `aiCoworkerProactivity:route-context:${ROUTE}`,
      value: JSON.stringify({ scopeKey: `route-context:${ROUTE}`, level: "quiet" }),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    }]);
    // Advise mode strips side-effecting tools from the authorized set.
    mocks.getAvailableTools.mockResolvedValue([READER]);

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.getAvailableTools).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "advise" }));
    expect(mocks.runAgenticLoop).not.toHaveBeenCalled();
    expect(recordedTask().lastStatus).toBe("error");
    expect(recordedTask().lastError).toMatch(/record_workroom_evidence is withheld at the advise action boundary/);
  });

  it("is not dispatched when the coworker is not authorized for the writer", async () => {
    mocks.getAvailableTools.mockResolvedValue([READER]);

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.runAgenticLoop).not.toHaveBeenCalled();
    expect(recordedTask().lastError).toMatch(/record_workroom_evidence is not authorized/);
  });

  it("corrects a model that says the attached writer is unavailable, once", async () => {
    mocks.runAgenticLoop
      .mockResolvedValueOnce({ content: UNAVAILABLE, executedTools: [{ name: "list_customer_accounts", args: {}, result: { success: true, message: "5 accounts" } }] })
      .mockResolvedValueOnce({ content: "Recorded.", executedTools: [{ name: "record_workroom_evidence", args: {}, result: { success: true, message: "ok" } }] });

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.runAgenticLoop).toHaveBeenCalledTimes(2);
    const retryHistory = mocks.runAgenticLoop.mock.calls[1]![0].chatHistory as Array<{ role: string; content: string }>;
    expect(retryHistory.at(-2)).toEqual({ role: "assistant", content: UNAVAILABLE });
    expect(retryHistory.at(-1)?.content).toMatch(/record_workroom_evidence is attached to this run/);
    expect(recordedTask().lastStatus).toBe("ok");
  });

  it("fails honestly after the one correction: the writer was offered and not called", async () => {
    mocks.runAgenticLoop.mockResolvedValue({ content: UNAVAILABLE, executedTools: [] });

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.runAgenticLoop).toHaveBeenCalledTimes(2);
    expect(recordedTask().lastError).toMatch(
      /record_workroom_evidence executed zero times; it was attached to the run and not called/,
    );
  });

  it("does not correct a run whose writer already persisted", async () => {
    mocks.runAgenticLoop.mockResolvedValue({ content: "Provider failed.", executedTools: [] });
    mocks.prisma.toolExecution.findFirst.mockResolvedValue({ id: "tool-execution-1" });

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.runAgenticLoop).toHaveBeenCalledTimes(1);
  });
});
