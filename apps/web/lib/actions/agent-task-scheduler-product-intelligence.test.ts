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
    agentThread: { upsert: vi.fn() },
    agentMessage: { create: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    userFact: { findMany: vi.fn() },
    taskRun: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    taskMessage: { create: vi.fn() },
    toolExecution: { findFirst: vi.fn() },
    marketingCampaignBrief: { findFirst: vi.fn() },
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
  proposeProductIntelligenceWatch: vi.fn(),
}));

vi.mock("@/lib/platform-runtime/work-admission", () => ({
  admitRuntimeGuardedWork: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
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
vi.mock("@/lib/product-management/product-intelligence-watch", () => ({
  PRODUCT_INTELLIGENCE_WATCH_TASK_KIND: "product-intelligence-watch",
  proposeProductIntelligenceWatch: mocks.proposeProductIntelligenceWatch,
}));

import { executeScheduledAgentTask } from "./agent-task-scheduler";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) =>
      callback(mocks.prisma),
  );
  mocks.prisma.scheduledAgentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
});

describe("executeScheduledAgentTask — product intelligence watch", () => {
  it("creates a pending proposal without entering the autonomous LLM loop", async () => {
    const task = {
      taskId: "agent-task-product-watch",
      agentId: "marketing-specialist",
      title: "Watch salon competitors",
      prompt: "Human-readable description only",
      routeContext: "/portfolio/product/product-1/direction/intelligence",
      schedule: "0 9 * * 1",
      timezone: "UTC",
      isActive: true,
      ownerUserId: "user-1",
      taskKind: "product-intelligence-watch",
      taskConfig: {
        topic: "competitive-landscape",
        query: "Changes in local salon competitors",
      },
      organizationId: "org-1",
      productLineId: null,
      businessProductId: "product-1",
      nextRunAt: new Date("2026-07-28T09:00:00.000Z"),
    };
    mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue(task);
    mocks.proposeProductIntelligenceWatch.mockResolvedValue({
      proposalId: "rp-1",
      created: true,
    });
    mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
    mocks.prisma.scheduledJob.update.mockResolvedValue({});

    await executeScheduledAgentTask(task.taskId);

    expect(mocks.proposeProductIntelligenceWatch).toHaveBeenCalledWith(task);
    expect(mocks.runAgenticLoop).not.toHaveBeenCalled();
    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: task.taskId },
        data: expect.objectContaining({
          lastStatus: "ok",
          lastError: null,
        }),
      }),
    );
  });
});
