// BI-754C9E82 — proactivity plan ENFORCEMENT on scheduled runs. Split from
// agent-task-scheduler.test.ts (module-size ratchet): same mock harness, only
// the enforcement describe block lives here.
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

// Pin the wall clock. The daily-cron re-arm assertion below compares
// nextRunAt against Date.now(), so a real clock makes it time-of-day
// dependent: the `7 14 * * *` schedule's next tick can fall <60min out when
// the suite runs shortly before the daily tick. computeNextCronRun resolves
// "14:07" with host-LOCAL Date methods (setHours/getDate), so the danger
// window is local time-of-day — a UTC-instant pin would still land inside it
// on a host whose local clock reads ~13:xx. Constructing FIXED_NOW from local
// components keeps the local time-of-day fixed at 09:00 on ANY host timezone,
// leaving the next 14:07 tick ~5h out. Only Date is faked (not timers) so real
// setTimeout/await in the code under test still resolves.
// (Month is 0-indexed: 6 = July.)
const FIXED_NOW = new Date(2026, 6, 12, 9, 0, 0, 0);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) => callback(mocks.prisma));
  // BI-D1CD3A11: the idempotent claim runs before execution; default to a WON
  // claim so these plan-behavior tests exercise the work.
  mocks.prisma.scheduledAgentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// Marketing Strategist coworker self-task fixture (mirrors the sibling file's
// arrangeMarketingSelfTask; duplicated because vitest mock harnesses are
// per-file).
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
    attempts: 0,
  });
  mocks.prisma.agentThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "user-1", isSuperuser: true });
  mocks.prisma.userFact.findMany.mockResolvedValue([]);
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

describe("executeScheduledAgentTask — proactivity plan enforcement (BI-754C9E82)", () => {
  // BI-87C9C91C: the level reaches the run through the WORK's route context, not
  // through the coworker's identity. The `agent:` scope these fixtures used to
  // carry no longer participates in resolution, so scoping them that way would
  // silently test nothing — every assertion below would pass on the default.
  const TASK_ROUTE = "/customer/marketing";
  function quietOverrideFact(_agentId: string) {
    return {
      id: "fact-quiet-1",
      key: `aiCoworkerProactivity:route-context:${TASK_ROUTE}`,
      value: JSON.stringify({ scopeKey: `route-context:${TASK_ROUTE}`, level: "quiet" }),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    };
  }
  function assertiveOverrideFact(_agentId: string) {
    return {
      id: "fact-assertive-1",
      key: `aiCoworkerProactivity:route-context:${TASK_ROUTE}`,
      value: JSON.stringify({ scopeKey: `route-context:${TASK_ROUTE}`, level: "assertive" }),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    };
  }

  it("gates tools to advise mode when the plan's actionBoundary is advise (quiet override)", async () => {
    arrangeMarketingSelfTask();
    // Quiet override → resolver returns actionBoundary "advise" for the run.
    mocks.prisma.userFact.findMany.mockResolvedValue([quietOverrideFact("marketing-specialist")]);
    mocks.runAgenticLoop.mockResolvedValue({ content: "ok", executedTools: [] });
    // Recency guard satisfied so the run does not force-create a brief.
    mocks.prisma.marketingCampaignBrief.findFirst.mockResolvedValue({ id: "brief-recent" });

    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    expect(mocks.getAvailableTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "advise" }),
    );
  });

  it("resolves act-mode tools when the boundary is propose (registry self-tasks are curated pre-authorized writes)", async () => {
    arrangeMarketingSelfTask();
    mocks.prisma.userFact.findMany.mockResolvedValue([]);
    mocks.runAgenticLoop.mockResolvedValue({
      content: "ok",
      executedTools: [{ name: "create_marketing_campaign_brief", args: {}, result: { success: true, message: "ok" } }],
    });

    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    expect(mocks.getAvailableTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "act" }),
    );
  });

  it("records the delegated posture on the run (dead resolveDelegatedPosture is now live)", async () => {
    arrangeMarketingSelfTask();
    mocks.prisma.userFact.findMany.mockResolvedValue([]);
    mocks.runAgenticLoop.mockResolvedValue({
      content: "ok",
      executedTools: [{ name: "create_marketing_campaign_brief", args: {}, result: { success: true, message: "ok" } }],
    });

    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    expect(mocks.prisma.taskRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          a2aMetadata: expect.objectContaining({
            delegatedPosture: expect.objectContaining({
              executionAllowed: true,
              proactivity: expect.objectContaining({
                actionBoundary: expect.any(String),
                effectiveLevel: expect.any(String),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("retries a failed run at the plan's follow-up cadence and increments attempts (assertive: +30min)", async () => {
    arrangeMarketingSelfTask();
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
      attempts: 0,
    });
    mocks.prisma.userFact.findMany.mockResolvedValue([assertiveOverrideFact("marketing-specialist")]);
    mocks.runAgenticLoop.mockRejectedValue(new Error("LLM unavailable"));

    const before = Date.now();
    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    const updateCall = mocks.prisma.scheduledAgentTask.update.mock.calls.find(
      (call) => call[0]?.data?.lastStatus === "error",
    );
    expect(updateCall).toBeTruthy();
    const data = updateCall![0].data;
    expect(data.attempts).toBe(1);
    // Assertive cadence[0] = 30 minutes — the retry lands ~30min out, far
    // before the daily cron's next tick.
    const deltaMinutes = (data.nextRunAt.getTime() - before) / 60_000;
    expect(deltaMinutes).toBeGreaterThan(25);
    expect(deltaMinutes).toBeLessThan(35);
  });

  it("re-arms the normal cron and resets attempts when the retry budget is exhausted", async () => {
    arrangeMarketingSelfTask();
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
      // Two failures already burned this cycle; assertive maxAttempts=3 means
      // this third failure exhausts the budget.
      attempts: 2,
    });
    mocks.prisma.userFact.findMany.mockResolvedValue([assertiveOverrideFact("marketing-specialist")]);
    mocks.runAgenticLoop.mockRejectedValue(new Error("LLM unavailable"));

    const before = Date.now();
    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    const updateCall = mocks.prisma.scheduledAgentTask.update.mock.calls.find(
      (call) => call[0]?.data?.lastStatus === "error",
    );
    expect(updateCall).toBeTruthy();
    const data = updateCall![0].data;
    expect(data.attempts).toBe(0);
    // Budget spent → back on the daily cron, not a near-term retry.
    const deltaMinutes = (data.nextRunAt.getTime() - before) / 60_000;
    expect(deltaMinutes).toBeGreaterThan(60);
  });

  it("resets attempts on success", async () => {
    arrangeMarketingSelfTask();
    mocks.prisma.userFact.findMany.mockResolvedValue([]);
    mocks.runAgenticLoop.mockResolvedValue({
      content: "ok",
      executedTools: [{ name: "create_marketing_campaign_brief", args: {}, result: { success: true, message: "ok" } }],
    });

    await executeScheduledAgentTask("self-marketing-specialist-user-1");

    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastStatus: "ok", attempts: 0 }),
      }),
    );
  });
});
