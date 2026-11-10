import { installScheduledTaskTransactionFixture } from "@/test-support/scheduled-task-transaction-fixture";
// BI-A8679D84 — how a scheduled run that did not do its governed write ends:
// never `completed`, typed on the TaskRun, the final correction step forced at
// the provider, and a provider-busy reply requeued instead of filed as a
// writer the model would not call. Same mock harness as
// agent-task-scheduler-required-writer.test.ts (vitest mock harnesses are per-file).
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
  loadStageDispatchAnswered: vi.fn(),
}));

// Authority is covered by the delivery flow suite; these tests isolate writer attachment/correction.
vi.mock("@/lib/work-management/room-stage-mandate", () => ({
  loadScheduledRoomAuthorityLive: async () => ({ mandatedTools: [], roomTurn: null, withheldBecause: null, deliveryStage: null }),
}));
vi.mock("@/lib/work-management/stage-dispatch-answered", () => ({ loadStageDispatchAnswered: mocks.loadStageDispatchAnswered }));
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
  installScheduledTaskTransactionFixture(mocks.prisma);
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
  mocks.prisma.taskRun.create.mockResolvedValue({ id: "task-run-row-1", taskRunId: "TR-SCHED-TERMINAL1", contextId: "thread-1" });
  mocks.prisma.taskMessage.create.mockResolvedValue({});
  mocks.prisma.taskRun.update.mockResolvedValue({});
  mocks.prisma.toolExecution.findFirst.mockResolvedValue(null);
  mocks.prisma.toolExecution.findMany.mockResolvedValue([]);
  mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
  mocks.prisma.scheduledJob.update.mockResolvedValue({});
  mocks.loadStageDispatchAnswered.mockResolvedValue({ answered: false });
});

afterEach(() => {
  vi.useRealTimers();
});

function recordedTask(): { lastStatus?: string; lastError?: string | null } {
  const calls = mocks.prisma.scheduledAgentTask.update.mock.calls;
  return calls[calls.length - 1]?.[0]?.data ?? {};
}

function taskRunUpdate(): { status?: string; progressPayload?: Record<string, unknown> } {
  const calls = mocks.prisma.taskRun.update.mock.calls;
  return calls[calls.length - 1]?.[0]?.data ?? {};
}

const SILENT_BRIEF = `You are executing one stage of a standing Workroom activity.
Room: WC-0A92C30D
Tools for this stage: list_customer_accounts.`;
const BUSY = "Every AI provider is busy right now — usually rate-limited or briefly overloaded. Nothing is misconfigured.";

describe("a scheduled run whose required writer executed zero times (BI-A8679D84)", () => {
  it("is never completed when its stage brief does not name the writer", async () => {
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      ...(await mocks.prisma.scheduledAgentTask.findUnique()), prompt: SILENT_BRIEF,
    });
    mocks.runAgenticLoop.mockResolvedValue({ content: "Done — the stage is complete.", executedTools: [] });

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.prisma.taskRun.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
    expect(taskRunUpdate()).toMatchObject({ status: "failed", progressPayload: { terminalOutcome: "no-governed-work", owner: "workroom-drive" } });
    expect(recordedTask().lastError).toMatch(/record_workroom_evidence executed zero times/);
  });

  it("types a run refused before dispatch as not-dispatched", async () => {
    mocks.getAvailableTools.mockResolvedValue([READER]);

    await executeScheduledAgentTask(TASK_ID);

    expect(taskRunUpdate()).toMatchObject({ status: "failed", progressPayload: { terminalOutcome: "not-dispatched", owner: "platform-engineer", nextAction: expect.stringMatching(/Grant the coworker/) } });
  });
});

describe("the correction step forces the writer at the provider (BI-A8679D84)", () => {
  it("runs the correction turn with the writer as the forced tool", async () => {
    mocks.runAgenticLoop
      .mockResolvedValueOnce({ content: UNAVAILABLE, executedTools: [] })
      .mockResolvedValueOnce({ content: "Recorded.", executedTools: [{ name: "record_workroom_evidence", args: {}, result: { success: true, message: "ok" } }] });

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.runAgenticLoop).toHaveBeenCalledTimes(2);
    expect(mocks.runAgenticLoop.mock.calls[0]![0].forcedToolName).toBeUndefined();
    expect(mocks.runAgenticLoop.mock.calls[1]![0].forcedToolName).toBe("record_workroom_evidence");
    expect(recordedTask().lastStatus).toBe("ok");
  });

  it("falls back to the unforced turn when no adapter can enforce the forced choice", async () => {
    mocks.runAgenticLoop
      .mockResolvedValueOnce({ content: UNAVAILABLE, executedTools: [] })
      .mockResolvedValueOnce({ content: "No adapter.", executedTools: [], failure: { kind: "required-terminal-writer-not-enforceable", message: "No adapter." } })
      .mockResolvedValueOnce({ content: "Recorded.", executedTools: [{ name: "record_workroom_evidence", args: {}, result: { success: true, message: "ok" } }] });

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.runAgenticLoop).toHaveBeenCalledTimes(3);
    expect(mocks.runAgenticLoop.mock.calls[2]![0].forcedToolName).toBeUndefined();
    expect(recordedTask().lastStatus).toBe("ok");
  });
});

describe("a provider-busy run is requeued, not filed as a writer the model would not call (BI-A8679D84)", () => {
  it("requeues without a correction turn and without spending a retry attempt", async () => {
    mocks.runAgenticLoop.mockResolvedValue({ content: BUSY, executedTools: [], failure: { kind: "busy", message: BUSY } });

    await executeScheduledAgentTask(TASK_ID);

    expect(mocks.runAgenticLoop).toHaveBeenCalledTimes(1);
    expect(taskRunUpdate()).toMatchObject({ status: "failed", progressPayload: { terminalOutcome: "provider-busy-requeue", owner: "agent-task-scheduler" } });
    const task = recordedTask() as { lastStatus?: string; lastError?: string; attempts?: number; nextRunAt?: Date };
    expect(task.lastStatus).toBe("retrying");
    expect(task.lastError).toMatch(/^Scheduled run produced no governed work \(rate-limit\)/);
    expect(task.lastError).not.toMatch(/executed zero times/);
    expect(task.attempts).toBe(0);
    expect(task.nextRunAt).toEqual(new Date(FIXED_NOW.getTime() + 30 * 60_000));
  });
});
