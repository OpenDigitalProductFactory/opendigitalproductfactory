import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({
  prisma: mocks.prisma,
  // executeScheduledAgentTask short-circuits to the deterministic data-model
  // mirror when task.taskId === DATA_MODEL_MIRROR_TASK_ID (EP-DATA-ARCH, #1618).
  // The const must be exported from the mock or vitest throws on access; none of
  // these tests use the mirror task id, so any non-matching value is fine.
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

import { executeScheduledAgentTask, scheduleAgentTask } from "./agent-task-scheduler";
import {
  extractDiscoveryTriageSummary,
  extractHiveScoutSummary,
} from "./agent-task-scheduler-summary";

beforeEach(() => {
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) => callback(mocks.prisma));
  vi.resetAllMocks();
  // BI-D1CD3A11: the idempotent claim (updateMany) runs before execution;
  // default to a WON claim so existing tests exercise the work. Per-test
  // overrides simulate losing the claim.
  mocks.prisma.scheduledAgentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
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
              reviewed: 1,
              reviewFailed: 0,
              reviewBatchSize: 1,
              reviewBatchUtilization: 0.083,
              reviewParseSuccessRate: 1,
              reviewSchemaDropCount: 1,
              reviewLatencyMs: 218,
              reviewClassificationHistogram: {
                force_human_review: 1,
              },
            },
          },
        },
      },
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.compactStatus).toContain("Discovery triage cadence");
    expect(summary?.compactStatus).toContain("processed=4");
    expect(summary?.compactStatus).toContain("taxonomy-gaps=1");
    expect(summary?.compactStatus).toContain("reviewed=1");
    expect(summary?.compactStatus).toContain("review-schema-drops=1");
    expect(summary?.threadMessage).toContain("[Scheduled summary: discovery taxonomy gap triage]");
    expect(summary?.threadMessage).toContain("\"runIdempotencyKey\": \"2026-04-25:inventory-specialist:cadence\"");
    expect(summary?.threadMessage).toContain("\"reviewClassificationHistogram\"");
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

describe("extractHiveScoutSummary", () => {
  it("preserves per-framework and per-industry review classification breakdowns", () => {
    const summary = extractHiveScoutSummary([
      {
        name: "run_hive_scout_ingest",
        args: {},
        result: {
          success: true,
          message: "ok",
          data: {
            catalogEntries: 3,
            gaps: 3,
            reviewed: 3,
            created: 2,
            duplicates: 0,
            skippedByReview: 1,
            reviewFailed: 0,
            reviewBatchSize: 3,
            reviewBatchUtilization: 0.25,
            reviewParseSuccessRate: 1,
            reviewSchemaDropCount: 0,
            reviewCacheHits: 0,
            reviewCacheHitRate: 0,
            reviewLatencyMs: 420,
            reviewClassificationHistogram: {
              new_archetype: 1,
              existing_skill_gap: 1,
              duplicate_pattern: 1,
            },
            reviewClassificationByFramework: {
              main: { new_archetype: 1 },
              crewai: { existing_skill_gap: 1 },
              autogen: { duplicate_pattern: 1 },
            },
            reviewClassificationByIndustry: {
              Cybersecurity: { new_archetype: 1 },
              Communication: { existing_skill_gap: 1 },
              Research: { duplicate_pattern: 1 },
            },
            deferred: 0,
          },
        },
      },
    ]);

    expect(summary?.payload?.metrics).toMatchObject({
      reviewClassificationByFramework: {
        main: { new_archetype: 1 },
        crewai: { existing_skill_gap: 1 },
        autogen: { duplicate_pattern: 1 },
      },
      reviewClassificationByIndustry: {
        Cybersecurity: { new_archetype: 1 },
        Communication: { existing_skill_gap: 1 },
        Research: { duplicate_pattern: 1 },
      },
    });
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
  mocks.prisma.userFact.findMany.mockResolvedValue([]);
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
  mocks.governedExecuteTool.mockResolvedValue({ success: true, message: "ok" });
  mocks.prisma.taskRun.create.mockResolvedValue({
    id: "task-run-row-1",
    taskRunId: "TR-SCHED-ABCDE",
    contextId: "thread-1",
  });
  mocks.prisma.taskMessage.create.mockResolvedValue({});
  mocks.prisma.taskRun.update.mockResolvedValue({});
  mocks.prisma.toolExecution.findFirst.mockResolvedValue({ id: "tool-execution-1" });
  mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
  mocks.prisma.scheduledJob.update.mockResolvedValue({});
}

function arrangeHiveScoutTask() {
  mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
    taskId: "external-catalog-scout-weekly",
    agentId: "external-catalog-scout",
    title: "External Catalog Scout",
    prompt: "Run the daily external catalog scout pass.",
    routeContext: "/platform/ai/operations",
    schedule: "17 8 * * *",
    timezone: "UTC",
    isActive: true,
    ownerUserId: "user-1",
  });
  mocks.prisma.agentThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "user-1", isSuperuser: true });
  mocks.prisma.userFact.findMany.mockResolvedValue([]);
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
  mocks.governedExecuteTool.mockResolvedValue({ success: true, message: "ok" });
  mocks.prisma.taskRun.create.mockResolvedValue({
    id: "task-run-row-1",
    taskRunId: "TR-SCHED-HIVE1",
    contextId: "thread-1",
  });
  mocks.prisma.taskMessage.create.mockResolvedValue({});
  mocks.prisma.taskRun.update.mockResolvedValue({});
  mocks.prisma.toolExecution.findFirst.mockResolvedValue({ id: "tool-execution-1" });
  mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
  mocks.prisma.scheduledJob.update.mockResolvedValue({});
}

// Marketing Strategist coworker self-task (Proactivity → autonomous, BI-3F09BDD4).
// taskId is the deterministic self-<agentId>-<userId>; routeContext carries the
// route's frontier modelRequirements floor.
function arrangeMarketingSelfTask() {
  mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
    taskId: "self-marketing-specialist-user-1",
    agentId: "marketing-specialist",
    title: "Refresh the acquisition campaign brief",
    prompt: "Keep a current acquisition campaign brief on the Campaigns page.",
    routeContext: "/customer/marketing",
    schedule: "7 14 * * *",
    timezone: "UTC",
    isActive: true,
    ownerUserId: "user-1",
  });
  mocks.prisma.agentThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "user-1", isSuperuser: true });
  mocks.prisma.userFact.findMany.mockResolvedValue([]);
  // The route resolver returns the Marketing Strategist WITH its frontier floor
  // (agent-routing.ts "/customer/marketing").
  mocks.resolveAgentForRouteWithPrompts.mockResolvedValue({
    agentId: "marketing-specialist",
    systemPrompt: "You are the Marketing Strategist.",
    sensitivity: "confidential",
    modelRequirements: { defaultMinimumTier: "frontier", defaultBudgetClass: "balanced" },
  });
  mocks.resolveAgentByIdWithPrompts.mockResolvedValue({
    agentId: "marketing-specialist",
    agentName: "Marketing Strategist",
    agentDescription: "Marketing",
    canAssist: true,
    systemPrompt: "You are the Marketing Strategist.",
    sensitivity: "confidential",
    skills: [],
  });
  mocks.prisma.agentMessage.findMany.mockResolvedValue([]);
  mocks.getAvailableTools.mockResolvedValue([
    {
      name: "create_marketing_campaign_brief",
      description: "Create a campaign brief",
      inputSchema: {},
      requiredCapability: "operate_marketing",
      executionMode: "immediate",
      sideEffect: true,
    },
  ]);
  mocks.toolsToOpenAIFormat.mockReturnValue([]);
  mocks.governedExecuteTool.mockResolvedValue({
    success: true,
    message: "Saved marketing campaign brief brief-1",
  });
  mocks.prisma.taskRun.create.mockResolvedValue({
    id: "task-run-row-1",
    taskRunId: "TR-SCHED-MKTG1",
    contextId: "thread-1",
  });
  mocks.prisma.taskMessage.create.mockResolvedValue({});
  mocks.prisma.taskRun.update.mockResolvedValue({});
  mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
  mocks.prisma.scheduledJob.update.mockResolvedValue({});
}

describe("executeScheduledAgentTask — coworker self-task model + required-tool guarantee (BI-3F09BDD4)", () => {
  it("carries the coworker's frontier modelRequirements into the scheduled run", async () => {
    arrangeMarketingSelfTask();
    mocks.prisma.toolExecution.findFirst.mockResolvedValue({ id: "te-1" });
    mocks.prisma.marketingCampaignBrief.findFirst.mockResolvedValue({ briefId: "brief-1" });
    mocks.runAgenticLoop.mockResolvedValue({
      content: "Saved campaign brief.",
      executedTools: [
        { name: "create_marketing_campaign_brief", args: {}, result: { success: true } },
      ],
    });

    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    const loopArgs = mocks.runAgenticLoop.mock.calls[0]?.[0];
    expect(loopArgs?.modelRequirements).toMatchObject({
      defaultMinimumTier: "frontier",
      defaultBudgetClass: "balanced",
    });
  });

  it("force-creates a brief when the loop narrated without calling the tool and no recent brief exists", async () => {
    arrangeMarketingSelfTask();
    // No successful tool call recorded this run, and no recent brief anywhere.
    mocks.prisma.toolExecution.findFirst.mockResolvedValue(null);
    mocks.prisma.marketingCampaignBrief.findFirst.mockResolvedValue(null);
    mocks.runAgenticLoop.mockResolvedValue({
      content: "Campaign brief recorded. Done.",
      executedTools: [],
    });

    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    expect(mocks.governedExecuteTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "create_marketing_campaign_brief",
        context: expect.objectContaining({
          routeContext: "/customer/marketing",
          agentId: "marketing-specialist",
          taskRunId: "TR-SCHED-MKTG1",
        }),
      }),
    );
  });

  it("does NOT force-create a brief when a recent brief already exists (recency guard)", async () => {
    arrangeMarketingSelfTask();
    // The loop didn't record a tool call this run, but a recent brief exists —
    // forcing would duplicate a placeholder, so the fallback must stand down.
    mocks.prisma.toolExecution.findFirst.mockResolvedValue(null);
    mocks.prisma.marketingCampaignBrief.findFirst.mockResolvedValue({ briefId: "brief-existing" });
    mocks.runAgenticLoop.mockResolvedValue({
      content: "Campaign brief recorded. Done.",
      executedTools: [],
    });

    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    expect(mocks.governedExecuteTool).not.toHaveBeenCalled();
  });
});

describe("executeScheduledAgentTask idempotent claim (BI-D1CD3A11)", () => {
  it("advances nextRunAt via a guarded claim BEFORE running the work", async () => {
    arrangeScheduledTask();
    mocks.runAgenticLoop.mockResolvedValue({ content: "Done.", executedTools: [] });

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    // The claim updateMany fired, guarded on the task still being due…
    const claim = mocks.prisma.scheduledAgentTask.updateMany.mock.calls[0]?.[0];
    expect(claim?.where).toMatchObject({ taskId: "discovery-taxonomy-gap-triage-daily", isActive: true });
    expect(claim?.where?.nextRunAt?.lte).toBeInstanceOf(Date);
    expect(claim?.data?.nextRunAt).toBeInstanceOf(Date);
    // …and it happened BEFORE the agentic loop ran.
    expect(mocks.prisma.scheduledAgentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runAgenticLoop.mock.invocationCallOrder[0],
    );
  });

  it("does NOT run the work when the claim is lost (a concurrent dispatch already claimed it)", async () => {
    arrangeScheduledTask();
    // The other dispatcher won the race → our guarded update matches 0 rows.
    mocks.prisma.scheduledAgentTask.updateMany.mockResolvedValue({ count: 0 });

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    // No double execution: the agentic loop and TaskRun creation never happen.
    expect(mocks.runAgenticLoop).not.toHaveBeenCalled();
    expect(mocks.prisma.taskRun.create).not.toHaveBeenCalled();
  });
});

describe("executeScheduledAgentTask TaskRun lifecycle", () => {
  it("creates a TaskRun before the first runAgenticLoop call and links it back to ScheduledAgentTask", async () => {
    arrangeScheduledTask();
    mocks.runAgenticLoop.mockResolvedValue({ content: "Done.", executedTools: [{ name: "run_discovery_triage", args: {}, result: { success: true } }] });

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    expect(mocks.prisma.taskRun.create).toHaveBeenCalledOnce();
    expect(mocks.prisma.taskRun.create.mock.calls[0]?.[0]?.data?.a2aMetadata?.proactivity).toMatchObject({ resolvedLevel: "balanced", policyId: "proactivity:scheduled-task:balanced", actionBoundary: "propose" });
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
          lastError: null,
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
    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "discovery-taxonomy-gap-triage-daily" },
        data: expect.objectContaining({
          lastStatus: "ok",
          lastError: null,
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

  it("procedurally executes required discovery triage when the model narrates instead of calling the tool", async () => {
    arrangeScheduledTask();
    mocks.prisma.toolExecution.findFirst.mockResolvedValue(null);
    mocks.runAgenticLoop.mockResolvedValue({
      content: "The tool subsystem is not available.",
      executedTools: [],
    });
    mocks.governedExecuteTool.mockResolvedValue({
      success: true,
      message: "Duplicate cadence triage run already recorded today.",
      data: {
        trigger: "cadence",
        processedAt: "2026-05-12T05:50:17.968Z",
        runIdempotencyKey: "2026-05-12:inventory-specialist:cadence",
        skipped: true,
        skipReason: "Duplicate cadence triage run already recorded today.",
        metrics: {
          processed: 0,
          decisionsCreated: 0,
          autoAttributed: 0,
          humanReview: 0,
          taxonomyGap: 0,
          needsMoreEvidence: 0,
          dismissed: 0,
          escalationQueueDepth: 0,
          repeatUnresolved: 0,
          autoApplyRate: 0,
        },
      },
    });

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    expect(mocks.governedExecuteTool).toHaveBeenCalledWith({
      toolName: "run_discovery_triage",
      rawParams: { trigger: "cadence" },
      userId: "user-1",
      userContext: { userId: "user-1", platformRole: null, isSuperuser: true },
      source: "agentic-loop",
      context: {
        routeContext: "/platform/tools/discovery",
        agentId: "inventory-specialist",
        threadId: "thread-1",
        taskRunId: "TR-SCHED-ABCDE",
      },
    });
    const agentTaskMessage = mocks.prisma.taskMessage.create.mock.calls.find(
      ([args]) => args.data.role === "agent",
    )?.[0];

    expect(agentTaskMessage?.data.parts[0].text).toContain("Discovery triage skipped");
    expect(agentTaskMessage?.data.parts[0].text).not.toContain("tool subsystem");
    expect(mocks.prisma.taskRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-run-row-1" },
        data: expect.objectContaining({
          progressPayload: expect.objectContaining({
            executedToolCount: 1,
          }),
        }),
      }),
    );
  });

  it("persists a required discovery triage receipt when the loop reports an unrecorded tool call", async () => {
    arrangeScheduledTask();
    mocks.prisma.toolExecution.findFirst.mockResolvedValue(null);
    mocks.runAgenticLoop.mockResolvedValue({
      content: "Done.",
      executedTools: [
        {
          name: "run_discovery_triage",
          args: { trigger: "cadence" },
          result: {
            success: true,
            message: "Duplicate cadence triage run already recorded today.",
            data: {
              trigger: "cadence",
              processedAt: "2026-05-12T06:35:12.297Z",
              runIdempotencyKey: "2026-05-12:inventory-specialist:cadence",
              skipped: true,
              skipReason: "Duplicate cadence triage run already recorded today.",
              metrics: {
                processed: 0,
                decisionsCreated: 0,
                autoAttributed: 0,
                humanReview: 0,
                taxonomyGap: 0,
                needsMoreEvidence: 0,
                dismissed: 0,
                escalationQueueDepth: 0,
                repeatUnresolved: 0,
                autoApplyRate: 0,
              },
            },
          },
        },
      ],
    });
    mocks.governedExecuteTool.mockResolvedValue({
      success: true,
      message: "Duplicate cadence triage run already recorded today.",
      data: { skipped: true, trigger: "cadence" },
    });

    await executeScheduledAgentTask("discovery-taxonomy-gap-triage-daily");

    expect(mocks.prisma.toolExecution.findFirst).toHaveBeenCalledWith({
      where: {
        taskRunId: "TR-SCHED-ABCDE",
        toolName: "run_discovery_triage",
        success: true,
      },
      select: { id: true },
    });
    expect(mocks.governedExecuteTool).toHaveBeenCalledWith({
      toolName: "run_discovery_triage",
      rawParams: { trigger: "cadence" },
      userId: "user-1",
      userContext: { userId: "user-1", platformRole: null, isSuperuser: true },
      source: "agentic-loop",
      context: {
        routeContext: "/platform/tools/discovery",
        agentId: "inventory-specialist",
        threadId: "thread-1",
        taskRunId: "TR-SCHED-ABCDE",
      },
    });
    expect(mocks.prisma.taskRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-run-row-1" },
        data: expect.objectContaining({
          progressPayload: expect.objectContaining({
            executedToolCount: 1,
          }),
        }),
      }),
    );
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
              reviewed: 4,
              created: 3,
              duplicates: 2,
              skippedByReview: 1,
              reviewBatchSize: 4,
              reviewBatchUtilization: 0.33,
              reviewParseSuccessRate: 0.75,
              reviewSchemaDropCount: 1,
              reviewCacheHits: 1,
              reviewCacheHitRate: 0.2,
              reviewLatencyMs: 842,
              reviewClassificationHistogram: {
                new_archetype: 2,
                duplicate_pattern: 1,
              },
              reviewClassificationByFramework: {
                main: { new_archetype: 1 },
                crewai: { duplicate_pattern: 1 },
              },
              reviewClassificationByIndustry: {
                Cybersecurity: { new_archetype: 2 },
                Communication: { duplicate_pattern: 1 },
              },
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
        text: expect.stringContaining("Hive Scout parsed=27 gaps=5 reviewed=4 created=3"),
      },
    ]);
    expect(agentTaskMessage?.data.parts[0].text).toContain("review-schema-drops=1");
    expect(agentTaskMessage?.data.parts[0].text).toContain("review-cache-hits=1");
    expect(agentTaskMessage?.data.parts[0].text).not.toContain("I stopped because");
    expect(mocks.prisma.taskRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-run-row-1" },
        data: expect.objectContaining({
          progressPayload: expect.objectContaining({
            scheduledSummaryPayload: expect.objectContaining({
              metrics: expect.objectContaining({
                reviewCacheHits: 1,
                reviewSchemaDropCount: 1,
                reviewClassificationByFramework: {
                  main: { new_archetype: 1 },
                  crewai: { duplicate_pattern: 1 },
                },
                reviewClassificationByIndustry: {
                  Cybersecurity: { new_archetype: 2 },
                  Communication: { duplicate_pattern: 1 },
                },
              }),
            }),
          }),
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
      schedule: "17 8 * * *",
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

describe("executeScheduledAgentTask — SysML projection reconcile branch", () => {
  it("runs the deterministic reconcile directly (no LLM loop) and records ok status", async () => {
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: "sysml-projection-nightly",
      isActive: true,
      schedule: "0 4 * * *",
    });
    mocks.runArchitectureParitySteward.mockResolvedValue({
      projections: {
        mcpAuthority: { status: "applied", created: 0, updated: 304, removed: 0, toolCount: 248, grantCount: 54 },
        coworkerAuthority: { status: "applied", created: 0, updated: 64, removed: 0 },
      },
      steward: { created: 1, updated: 0, resolved: 0 },
    });
    mocks.runConsolidationParitySteward.mockResolvedValue({
      created: 0, updated: 0, resolved: 0, outstandingBets: [], completedBets: [],
    });
    mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
    mocks.prisma.scheduledJob.update.mockResolvedValue({});

    await executeScheduledAgentTask("sysml-projection-nightly");

    expect(mocks.runArchitectureParitySteward).toHaveBeenCalledOnce();
    expect(mocks.runConsolidationParitySteward).toHaveBeenCalledOnce();
    expect(mocks.runAgenticLoop).not.toHaveBeenCalled();
    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "sysml-projection-nightly" },
        data: expect.objectContaining({ lastStatus: "ok", lastError: null }),
      }),
    );
  });

  it("records error status when the reconcile throws", async () => {
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: "sysml-projection-nightly",
      isActive: true,
      schedule: "0 4 * * *",
    });
    mocks.runArchitectureParitySteward.mockRejectedValue(new Error("notation missing"));
    mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
    mocks.prisma.scheduledJob.update.mockResolvedValue({});

    await executeScheduledAgentTask("sysml-projection-nightly");

    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "sysml-projection-nightly" },
        data: expect.objectContaining({ lastStatus: "error", lastError: "notation missing" }),
      }),
    );
  });
});

describe("executeScheduledAgentTask one-shot deactivation (BI-D72CC945)", () => {
  it("deactivates a one-shot (Once) task after it fires instead of re-arming", async () => {
    arrangeScheduledTask();
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: "agent-task-once1",
      agentId: "platform-engineer",
      title: "One-shot scan",
      prompt: "Do the thing once.",
      routeContext: "/platform",
      schedule: "0 9 5 7 *", // Once: July 5
      timezone: "UTC",
      isActive: true,
      ownerUserId: "user-1",
    });
    mocks.runAgenticLoop.mockResolvedValue({ content: "Done.", executedTools: [] });

    await executeScheduledAgentTask("agent-task-once1");

    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "agent-task-once1" },
        data: expect.objectContaining({
          lastStatus: "ok",
          isActive: false,
          nextRunAt: null,
        }),
      }),
    );
  });

  it("re-arms a recurring (Monthly) task with a real next-run date and leaves it active", async () => {
    arrangeScheduledTask();
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: "agent-task-monthly1",
      agentId: "platform-engineer",
      title: "Monthly scan",
      prompt: "Do the monthly thing.",
      routeContext: "/platform",
      schedule: "0 9 1 * *", // Monthly
      timezone: "UTC",
      isActive: true,
      ownerUserId: "user-1",
    });
    mocks.runAgenticLoop.mockResolvedValue({ content: "Done.", executedTools: [] });

    await executeScheduledAgentTask("agent-task-monthly1");

    const okUpdate = mocks.prisma.scheduledAgentTask.update.mock.calls.find(
      ([arg]) => arg.where.taskId === "agent-task-monthly1" && arg.data.lastStatus === "ok",
    );
    expect(okUpdate).toBeDefined();
    expect(okUpdate?.[0].data.nextRunAt).toBeInstanceOf(Date);
    expect(okUpdate?.[0].data.isActive).toBeUndefined();
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

describe("executeScheduledAgentTask — self-optimization sweep branch", () => {
  it("runs the deterministic sweep directly (no LLM loop) and records ok status", async () => {
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: "self-optimization-sweep-weekly",
      isActive: true,
      schedule: "0 5 * * 1",
    });
    mocks.runSelfOptimizationSweep.mockResolvedValue({
      ranAt: "2026-07-09T05:00:00.000Z",
      graphAvailable: true,
      outstandingBets: ["BET-11"],
      completedBets: ["BET-6"],
      stalledBets: [],
      parity: { created: 0, updated: 0, resolved: 0 },
      blastRadius: { implementationFileCount: 1, relatedTestCount: 1 },
    });
    mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
    mocks.prisma.scheduledJob.update.mockResolvedValue({});

    await executeScheduledAgentTask("self-optimization-sweep-weekly");

    expect(mocks.runSelfOptimizationSweep).toHaveBeenCalledOnce();
    expect(mocks.runAgenticLoop).not.toHaveBeenCalled();
    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "self-optimization-sweep-weekly" },
        data: expect.objectContaining({ lastStatus: "ok", lastError: null }),
      }),
    );
  });

  it("records error status when the sweep throws", async () => {
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: "self-optimization-sweep-weekly",
      isActive: true,
      schedule: "0 5 * * 1",
    });
    mocks.runSelfOptimizationSweep.mockRejectedValue(new Error("graph store down"));
    mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
    mocks.prisma.scheduledJob.update.mockResolvedValue({});

    await executeScheduledAgentTask("self-optimization-sweep-weekly");

    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "self-optimization-sweep-weekly" },
        data: expect.objectContaining({ lastStatus: "error", lastError: "graph store down" }),
      }),
    );
  });
});
