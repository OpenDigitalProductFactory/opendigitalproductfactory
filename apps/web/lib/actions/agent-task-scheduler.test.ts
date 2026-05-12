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
  resolveAgentByIdWithPrompts: vi.fn(),
  runAgenticLoop: vi.fn(),
  getAvailableTools: vi.fn(),
  toolsToOpenAIFormat: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
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
  mocks.resolveAgentByIdWithPrompts.mockResolvedValue({
    agentId: "inventory-specialist",
    agentName: "Inventory Specialist",
    agentDescription: "Inventory",
    canAssist: true,
    systemPrompt: "You are Inventory Specialist.",
    sensitivity: "internal",
    skills: [],
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

function arrangeHiveScoutTask() {
  mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
    taskId: "external-catalog-scout-weekly",
    agentId: "external-catalog-scout",
    title: "External Catalog Scout",
    prompt: "Run the weekly external catalog scout pass.",
    routeContext: "/platform/ai/operations",
    schedule: "17 8 * * 1",
    timezone: "UTC",
    isActive: true,
    ownerUserId: "user-1",
  });
  mocks.prisma.agentThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "user-1", isSuperuser: true });
  mocks.resolveAgentForRouteWithPrompts.mockResolvedValue({
    agentId: "platform-engineer",
    systemPrompt: "You are Platform Engineer.",
    sensitivity: "internal",
  });
  mocks.resolveAgentByIdWithPrompts.mockResolvedValue({
    agentId: "external-catalog-scout",
    agentName: "External Catalog Scout",
    agentDescription: "Catalog scout",
    canAssist: true,
    systemPrompt: "You are External Catalog Scout.",
    sensitivity: "internal",
    skills: [],
  });
  mocks.getAvailableTools.mockResolvedValue([
    {
      name: "run_hive_scout_ingest",
      description: "Run Hive Scout",
      inputSchema: {},
      requiredCapability: null,
      executionMode: "immediate",
      sideEffect: true,
    },
  ]);
  mocks.toolsToOpenAIFormat.mockReturnValue([]);
  mocks.prisma.taskRun.create.mockResolvedValue({
    id: "task-run-row-1",
    taskRunId: "TR-SCHED-HIVE1",
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

  it("uses the structured scheduled summary for task-facing agent messages when a triage tool ran", async () => {
    arrangeScheduledTask();
    mocks.runAgenticLoop.mockResolvedValue({
      content: "I stopped because I was still describing work without using the required tools.",
      executedTools: [
        {
          name: "run_discovery_triage",
          args: { trigger: "cadence" },
          result: {
            success: true,
            message: "ok",
            data: {
              trigger: "cadence",
              processedAt: "2026-05-12T00:25:12.506Z",
              runIdempotencyKey: "2026-05-12:inventory-specialist:cadence",
              metrics: {
                processed: 1,
                decisionsCreated: 1,
                autoAttributed: 0,
                humanReview: 0,
                taxonomyGap: 0,
                needsMoreEvidence: 1,
                dismissed: 0,
                escalationQueueDepth: 0,
                repeatUnresolved: 1,
                autoApplyRate: 0,
              },
            },
          },
        },
      ],
    });

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    const agentTaskMessage = mocks.prisma.taskMessage.create.mock.calls.find(
      ([args]) => args.data.role === "agent",
    )?.[0];

    expect(agentTaskMessage?.data.parts).toEqual([
      {
        type: "message",
        text: expect.stringContaining("Discovery triage cadence processed=1"),
      },
    ]);
    expect(agentTaskMessage?.data.parts[0].text).not.toContain("I stopped because");
  });

  it("uses a structured Hive Scout summary for task-facing agent messages when the scout tool ran", async () => {
    arrangeHiveScoutTask();
    mocks.runAgenticLoop.mockResolvedValue({
      content: "I stopped because I was still describing work without using the required tools.",
      executedTools: [
        {
          name: "run_hive_scout_ingest",
          args: {},
          result: {
            success: true,
            message: "ok",
            data: {
              catalogEntries: 27,
              gaps: 5,
              created: 3,
              duplicates: 2,
              deferred: 1,
              createdItemIds: ["HS-1", "HS-2", "HS-3"],
            },
          },
        },
      ],
    });

    await executeScheduledAgentTask("external-catalog-scout-weekly");

    const agentTaskMessage = mocks.prisma.taskMessage.create.mock.calls.find(
      ([args]) => args.data.role === "agent",
    )?.[0];

    expect(agentTaskMessage?.data.parts).toEqual([
      {
        type: "message",
        text: expect.stringContaining("Hive Scout parsed=27 gaps=5 created=3"),
      },
    ]);
    expect(agentTaskMessage?.data.parts[0].text).not.toContain("I stopped because");
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

  it("executes scheduled tasks with only the current scheduled prompt, not stale thread history", async () => {
    arrangeScheduledTask();
    mocks.prisma.agentMessage.findMany.mockResolvedValue([
      { role: "user", content: "Prior scheduled prompt." },
      { role: "assistant", content: "Previous tool failure." },
      { role: "assistant", content: "[Scheduled summary: old run]" },
    ]);
    mocks.runAgenticLoop.mockResolvedValue({
      content: "Done.",
      executedTools: [],
    });

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    expect(mocks.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        chatHistory: [
          {
            role: "user",
            content: "[Scheduled task: Discovery Taxonomy Gap Triage]\n\nTriage taxonomy gaps.",
          },
        ],
      }),
    );
  });

  it("resolves the scheduled coworker by task.agentId when the route persona differs", async () => {
    arrangeScheduledTask();
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: "external-catalog-scout-weekly",
      agentId: "external-catalog-scout",
      title: "External Catalog Scout",
      prompt: "Run the catalog scout.",
      routeContext: "/platform/ai/operations",
      schedule: "17 8 * * 1",
      timezone: "UTC",
      isActive: true,
      ownerUserId: "user-1",
    });
    mocks.runAgenticLoop.mockResolvedValue({
      content: "Done.",
      executedTools: [],
    });

    await executeScheduledAgentTask("external-catalog-scout-weekly");

    expect(mocks.resolveAgentByIdWithPrompts).toHaveBeenCalledWith(
      "external-catalog-scout",
      expect.objectContaining({
        userId: "user-1",
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
