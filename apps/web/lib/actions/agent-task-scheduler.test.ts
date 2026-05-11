import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    scheduledAgentTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    scheduledJob: {
      update: vi.fn(),
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
    taskRun: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    taskMessage: {
      create: vi.fn(),
    },
  },
  resolveAgentForRouteWithPrompts: vi.fn(),
  runAgenticLoop: vi.fn(),
  getAvailableTools: vi.fn(),
  toolsToOpenAIFormat: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/tak/agent-routing-server", () => ({
  resolveAgentForRouteWithPrompts: mocks.resolveAgentForRouteWithPrompts,
}));
vi.mock("@/lib/tak/agentic-loop", () => ({
  runAgenticLoop: mocks.runAgenticLoop,
}));
vi.mock("@/lib/mcp-tools", () => ({
  getAvailableTools: mocks.getAvailableTools,
  toolsToOpenAIFormat: mocks.toolsToOpenAIFormat,
  executeTool: mocks.executeTool,
}));

import {
  executeScheduledAgentTask,
  scheduleAgentTask,
} from "./agent-task-scheduler";
import { extractDiscoveryTriageSummary } from "./agent-task-scheduler-summary";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("extractDiscoveryTriageSummary", () => {
  it("builds a compact status string and thread payload for executed triage runs", () => {
    const summary = extractDiscoveryTriageSummary([
      {
        name: "run_discovery_triage",
        args: { trigger: "cadence" },
        result: {
          success: true,
          message: "ok",
          data: {
            trigger: "cadence",
            processedAt: "2026-04-25T18:00:00.000Z",
        runIdempotencyKey: "2026-04-25:inventory-specialist:cadence",
            metrics: {
              processed: 4,
              decisionsCreated: 4,
              autoAttributed: 2,
              humanReview: 1,
              taxonomyGap: 1,
              needsMoreEvidence: 0,
              dismissed: 0,
              escalationQueueDepth: 2,
              repeatUnresolved: 1,
              autoApplyRate: 0.5,
            },
          },
        },
      },
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.compactStatus).toContain("Discovery triage cadence");
    expect(summary?.compactStatus).toContain("processed=4");
    expect(summary?.compactStatus).toContain("taxonomy-gaps=1");
    expect(summary?.threadMessage).toContain("[Scheduled summary: discovery taxonomy gap triage]");
    expect(summary?.threadMessage).toContain("\"runIdempotencyKey\": \"2026-04-25:inventory-specialist:cadence\"");
  });

  it("reports skipped triage runs with the idempotency key", () => {
    const summary = extractDiscoveryTriageSummary([
      {
        name: "run_discovery_triage",
        args: { trigger: "volume" },
        result: {
          success: true,
          message: "skipped",
          data: {
            trigger: "volume",
            processedAt: "2026-04-25T18:00:00.000Z",
        runIdempotencyKey: "2026-04-25:inventory-specialist:volume",
            skipped: true,
            skipReason: "Duplicate volume triage run already recorded today.",
            metrics: {
              processed: 0,
              autoAttributed: 0,
              escalationQueueDepth: 0,
              taxonomyGap: 0,
            },
          },
        },
      },
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.compactStatus).toContain("skipped");
    expect(summary?.compactStatus).toContain("[2026-04-25:inventory-specialist:volume]");
    expect(summary?.threadMessage).toContain("Duplicate volume triage run already recorded today.");
    expect(summary?.threadMessage).toContain("\"skipped\": true");
  });

  it("returns null when no discovery triage tool execution is present", () => {
    const summary = extractDiscoveryTriageSummary([
      {
        name: "query_backlog",
        args: {},
        result: {
          success: true,
          message: "ok",
          data: { rows: [] },
        },
      },
    ]);

    expect(summary).toBeNull();
  });
});

function arrangeScheduledTask() {
  mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
    taskId: "discovery-taxonomy-gap-triage-daily",
    agentId: "inventory-specialist",
    title: "Discovery Taxonomy Gap Triage",
    prompt: "Triage taxonomy gaps.",
    routeContext: "/platform/tools/discovery",
    schedule: "0 8 * * *",
    timezone: "UTC",
    isActive: true,
    ownerUserId: "user-1",
  });
  mocks.prisma.agentThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "user-1", isSuperuser: true });
  mocks.resolveAgentForRouteWithPrompts.mockResolvedValue({
    systemPrompt: "You are Inventory Specialist.",
    sensitivity: "internal",
  });
  mocks.prisma.agentMessage.findMany.mockResolvedValue([
    { role: "user", content: "Triage taxonomy gaps." },
  ]);
  mocks.getAvailableTools.mockResolvedValue([
    {
      name: "run_discovery_triage",
      description: "Run triage",
      inputSchema: {},
      requiredCapability: null,
      executionMode: "immediate",
      sideEffect: false,
    },
  ]);
  mocks.toolsToOpenAIFormat.mockReturnValue([]);
  mocks.prisma.taskRun.create.mockResolvedValue({
    id: "task-run-row-1",
    taskRunId: "TR-SCHED-ABCDE",
    contextId: "thread-1",
  });
  mocks.prisma.taskMessage.create.mockResolvedValue({});
  mocks.prisma.taskRun.update.mockResolvedValue({});
  mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
  mocks.prisma.scheduledJob.update.mockResolvedValue({});
}

describe("executeScheduledAgentTask TaskRun lifecycle", () => {
  it("creates a TaskRun before the first runAgenticLoop call and links it back to ScheduledAgentTask", async () => {
    arrangeScheduledTask();
    mocks.runAgenticLoop.mockResolvedValue({
      content: "Done.",
      executedTools: [{ name: "run_discovery_triage", args: {}, result: { success: true } }],
    });

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    expect(mocks.prisma.taskRun.create).toHaveBeenCalledOnce();
    expect(mocks.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: "TR-SCHED-ABCDE",
        agentId: "inventory-specialist",
        threadId: "thread-1",
      }),
    );
    expect(mocks.prisma.taskRun.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runAgenticLoop.mock.invocationCallOrder[0],
    );
    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "discovery-taxonomy-gap-triage-daily" },
        data: expect.objectContaining({
          lastStatus: "ok",
          taskRunId: "TR-SCHED-ABCDE",
        }),
      }),
    );
    expect(mocks.prisma.taskRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-run-row-1" },
        data: expect.objectContaining({
          status: "completed",
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("marks the TaskRun failed and preserves the next schedule when the loop throws", async () => {
    arrangeScheduledTask();
    mocks.runAgenticLoop.mockRejectedValue(new Error("LLM unavailable"));

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    expect(mocks.prisma.taskRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-run-row-1" },
        data: expect.objectContaining({
          status: "failed",
          completedAt: expect.any(Date),
          progressPayload: { error: "LLM unavailable" },
        }),
      }),
    );
    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "discovery-taxonomy-gap-triage-daily" },
        data: expect.objectContaining({
          lastStatus: "error",
          lastError: "LLM unavailable",
          taskRunId: "TR-SCHED-ABCDE",
          nextRunAt: expect.any(Date),
        }),
      }),
    );
  });
});

describe("scheduleAgentTask UTC-only timezone", () => {
  it("rejects non-UTC timezone with an explanatory error", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });

    const result = await scheduleAgentTask({
      agentId: "inventory-specialist",
      title: "Discovery Taxonomy Gap Triage",
      prompt: "Triage taxonomy gaps.",
      routeContext: "/platform/tools/discovery",
      schedule: "0 8 * * *",
      timezone: "America/Chicago",
    });

    expect(result).toEqual({
      success: false,
      error: expect.stringMatching(/Non-UTC timezones are not yet supported/),
    });
    expect(mocks.prisma.scheduledAgentTask.create).not.toHaveBeenCalled();
  });
});
