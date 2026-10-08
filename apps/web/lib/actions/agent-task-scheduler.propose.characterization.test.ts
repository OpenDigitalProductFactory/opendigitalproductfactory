// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S2 in
// the scheduler. Pins how a scheduled run treats a call that propose-
// interception diverted, TODAY (spec D2 S2, named delta (a)):
//   - the playbook verdict: a diverted call is a success, so the run is
//     `completed`; only a `success: false` (today only propose_divert_failed)
//     makes it `partial`;
//   - the required-tool verdict: a diverted required write reads as
//     "proposed", never as a failure (detectScheduledRunFailure);
//   - the forced fallback re-calls a required tool the run did not persist,
//     with the SAME TaskRun, through the governed executor — the collision PR-A's
//     no-pause rule exists for.
// PR-B's only named delta here: a grant/identity refusal under the boundary
// becomes `success: false` and so counts toward `partial`.
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
  proposeProductIntelligenceWatch: vi.fn(),
  prepareProductManagementPlaybookRun: vi.fn(),
  completeProductManagementPlaybookRun: vi.fn(),
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
vi.mock("@/lib/product-management/product-intelligence-watch", () => ({
  PRODUCT_INTELLIGENCE_WATCH_TASK_KIND: "product-intelligence-watch",
  proposeProductIntelligenceWatch: mocks.proposeProductIntelligenceWatch,
}));
vi.mock("@/lib/product-management/product-management-playbook-run", () => ({
  prepareProductManagementPlaybookRun:
    mocks.prepareProductManagementPlaybookRun,
  completeProductManagementPlaybookRun:
    mocks.completeProductManagementPlaybookRun,
}));

import { executeScheduledAgentTask } from "./agent-task-scheduler";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) => callback(mocks.prisma));
  // BI-D1CD3A11: the idempotent claim (updateMany) runs before execution;
  // default to a WON claim so existing tests exercise the work. Per-test
  // overrides simulate losing the claim.
  mocks.prisma.scheduledAgentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
});

import { buildProposalToolResult } from "@/lib/proactivity/propose-interception";
import { detectScheduledRunFailure } from "@/lib/tak/scheduled-task-runs";

function arrangeCommon(task: Record<string, unknown>) {
  mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue(task);
  mocks.prisma.agentThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.agentMessage.findMany.mockResolvedValue([]);
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "user-1", isSuperuser: true });
  mocks.prisma.userFact.findMany.mockResolvedValue([]);
  mocks.resolveAgentForRouteWithPrompts.mockResolvedValue({ systemPrompt: "You are a coworker.", sensitivity: "internal" });
  mocks.resolveAgentByIdWithPrompts.mockResolvedValue({
    agentId: task.agentId, agentName: "Coworker", agentDescription: "x", canAssist: true,
    systemPrompt: "You are a coworker.", sensitivity: "internal", skills: [],
  });
  mocks.toolsToOpenAIFormat.mockReturnValue([]);
  mocks.prisma.taskRun.create.mockResolvedValue({ id: "task-run-row-1", taskRunId: "TR-SCHED-PROP1", contextId: "thread-1" });
  mocks.prisma.taskMessage.create.mockResolvedValue({});
  mocks.prisma.taskRun.update.mockResolvedValue({});
  mocks.prisma.toolExecution.findMany.mockResolvedValue([]);
  mocks.prisma.scheduledAgentTask.update.mockResolvedValue({});
  mocks.prisma.scheduledJob.update.mockResolvedValue({});
}

const PLAYBOOK_TASK = {
  taskId: "agent-task-product-playbook",
  agentId: "portfolio-advisor",
  title: "Roadmap refresh",
  prompt: "Typed recipe executes at runtime.",
  routeContext: "/portfolio/product/product-1/direction",
  schedule: "0 9 * * 4",
  timezone: "UTC",
  isActive: true,
  ownerUserId: "user-1",
  taskKind: "product-management-playbook",
  taskConfig: { schemaVersion: 1, recipeId: "roadmap-refresh", permissionsDigest: "pm-1", minimumRefreshMinutes: 60 },
  organizationId: "org-1",
  productLineId: null,
  businessProductId: "product-1",
};

function arrangePlaybook(executedResult: Record<string, unknown>) {
  arrangeCommon(PLAYBOOK_TASK);
  mocks.prepareProductManagementPlaybookRun.mockResolvedValue({
    unchanged: false, config: PLAYBOOK_TASK.taskConfig, fingerprint: "pm-input-1", sources: [], prompt: "Refresh the roadmap.",
  });
  mocks.completeProductManagementPlaybookRun.mockImplementation((config: unknown) => config);
  mocks.getAvailableTools.mockResolvedValue([
    { name: "update_roadmap_item", description: "Update", inputSchema: {}, requiredCapability: null, executionMode: "immediate", sideEffect: true },
  ]);
  mocks.runAgenticLoop.mockResolvedValue({
    content: "Proposed one roadmap change.",
    executedTools: [{ name: "update_roadmap_item", args: { id: "R-1" }, result: executedResult }],
  });
}

function playbookOutcome(): unknown {
  const update = mocks.prisma.taskRun.update.mock.calls.find(([arg]) => arg.data?.status === "completed")?.[0];
  return update?.data.progressPayload.productManagementPlaybook.outcome;
}

describe("S2 in the scheduler — the playbook verdict for a diverted call (characterisation)", () => {
  it("a diverted call is a success: the playbook run is completed", async () => {
    arrangePlaybook(buildProposalToolResult("update_roadmap_item", "prop-1") as unknown as Record<string, unknown>);
    await executeScheduledAgentTask(PLAYBOOK_TASK.taskId);
    expect(playbookOutcome()).toBe("completed");
    expect(mocks.completeProductManagementPlaybookRun).toHaveBeenCalledWith(
      PLAYBOOK_TASK.taskConfig, expect.objectContaining({ status: "completed" }),
    );
  });

  it("a failed divert (propose_divert_failed) is the only success:false a divert makes: partial", async () => {
    arrangePlaybook({ success: false, error: "propose_divert_failed", message: "Could not queue" });
    await executeScheduledAgentTask(PLAYBOOK_TASK.taskId);
    expect(playbookOutcome()).toBe("partial");
    expect(mocks.prisma.scheduledAgentTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId: PLAYBOOK_TASK.taskId },
      data: expect.objectContaining({ lastStatus: "partial" }),
    }));
  });
});

describe("S2 — detectScheduledRunFailure for a diverted required write (characterisation)", () => {
  const authorizedTools = [{ name: "record_workroom_evidence", sideEffect: true }];
  const prompt = "Record the stage evidence with record_workroom_evidence.";

  it("a diverted call is 'proposed', never a failure", () => {
    const executedTools = [{ name: "record_workroom_evidence", result: buildProposalToolResult("record_workroom_evidence", "prop-1") }];
    expect(detectScheduledRunFailure({ prompt, authorizedTools, executedTools, content: "Proposed it." })).toBeNull();
  });

  it("a failed divert is not counted as the write having run", () => {
    const executedTools = [{ name: "record_workroom_evidence", result: { success: false } }];
    expect(detectScheduledRunFailure({ prompt, authorizedTools, executedTools, content: "Could not." }))
      .toBe("required governed tool record_workroom_evidence executed zero times");
  });
});

const TRIAGE_TASK = {
  taskId: "discovery-taxonomy-gap-triage-daily",
  agentId: "inventory-specialist",
  title: "Discovery Taxonomy Gap Triage",
  prompt: "Triage taxonomy gaps.",
  routeContext: "/platform/tools/discovery",
  schedule: "0 8 * * *",
  timezone: "UTC",
  isActive: true,
  ownerUserId: "user-1",
};

describe("S2 — the forced fallback after a diverted required tool (characterisation)", () => {
  it("re-calls the required tool on the same TaskRun through the governed executor, counted once", async () => {
    arrangeCommon(TRIAGE_TASK);
    mocks.getAvailableTools.mockResolvedValue([
      { name: "run_discovery_triage", description: "Run triage", inputSchema: {}, requiredCapability: null, executionMode: "immediate", sideEffect: true },
    ]);
    mocks.prisma.toolExecution.findFirst.mockResolvedValue(null);
    mocks.runAgenticLoop.mockResolvedValue({
      content: "Proposed the triage run.",
      executedTools: [{ name: "run_discovery_triage", args: { trigger: "cadence" }, result: buildProposalToolResult("run_discovery_triage", "prop-2") }],
    });
    mocks.governedExecuteTool.mockResolvedValue({ success: true, message: "Triage ran." });

    await executeScheduledAgentTask(TRIAGE_TASK.taskId);

    expect(mocks.runAgenticLoop).toHaveBeenCalledWith(expect.objectContaining({ proposeSideEffects: true, taskRunId: "TR-SCHED-PROP1" }));
    expect(mocks.governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(mocks.governedExecuteTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "run_discovery_triage",
      rawParams: { trigger: "cadence" },
      source: "agentic-loop",
      context: expect.objectContaining({ taskRunId: "TR-SCHED-PROP1", agentId: "inventory-specialist", threadId: "thread-1" }),
    }));
    expect(mocks.prisma.taskRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ progressPayload: expect.objectContaining({ executedToolCount: 1 }) }),
    }));
  });
});
