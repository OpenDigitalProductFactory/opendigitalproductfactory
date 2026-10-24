// apps/web/lib/queue/functions/deliberation-run.test.ts
// Task 6.9 — Async runner tests.
//
// Covers:
//   - resumes an incomplete run (skips completed branches)
//   - does not restart completed branches
//   - emits queued / dispatched / completed / degraded / finished events
//   - records honest actualDiversity when routing returns duplicates

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  taskRunUpdate: vi.fn(),
  taskRunUpdateMany: vi.fn(),
  taskRunFindUnique: vi.fn(),
  deliberationRunFindUnique: vi.fn(),
  deliberationRunUpdate: vi.fn(),
  taskNodeUpdate: vi.fn(),
  taskNodeFindMany: vi.fn(),
  outcomeCreate: vi.fn(),
  outcomeUpsert: vi.fn(),
  issueSetCreate: vi.fn(),
  issueSetDeleteMany: vi.fn(),
  claimCreate: vi.fn(),
  claimDeleteMany: vi.fn(),
  pushThreadProgress: vi.fn(),
  getPattern: vi.fn(),
  extractRoleRecipes: vi.fn(),
  routeEndpointV2: vi.fn(),
  loadEndpointManifests: vi.fn(),
  loadPolicyRules: vi.fn(),
  loadOverrides: vi.fn(),
  routeAndCall: vi.fn(),
}));

vi.mock("@/lib/inference/routed-inference", () => ({ routeAndCall: mocks.routeAndCall }));
vi.mock("@/lib/jobs", () => ({ jobs: { createFunction: (_config: unknown, handler: unknown) => handler } }));
vi.mock("../quiescence-gates", () => ({ gateBetweenSteps: async () => ({ reason: null }) }));

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    taskRun: {
      update: mocks.taskRunUpdate,
      updateMany: mocks.taskRunUpdateMany,
      findUnique: mocks.taskRunFindUnique,
    },
    deliberationRun: {
      findUnique: mocks.deliberationRunFindUnique,
      update: mocks.deliberationRunUpdate,
    },
    taskNode: {
      update: mocks.taskNodeUpdate,
      findMany: mocks.taskNodeFindMany,
    },
    deliberationOutcome: { create: mocks.outcomeCreate, upsert: mocks.outcomeUpsert },
    deliberationIssueSet: {
      create: mocks.issueSetCreate,
      deleteMany: mocks.issueSetDeleteMany,
    },
    claimRecord: { create: mocks.claimCreate, deleteMany: mocks.claimDeleteMany },
  },
}));

vi.mock("@/lib/tak/thread-progress", () => ({
  pushThreadProgress: mocks.pushThreadProgress,
}));

vi.mock("@/lib/deliberation/registry", () => ({
  getPattern: mocks.getPattern,
  extractRoleRecipes: mocks.extractRoleRecipes,
}));

vi.mock("@/lib/routing/pipeline-v2", () => ({
  routeEndpointV2: mocks.routeEndpointV2,
}));

vi.mock("@/lib/routing/loader", () => ({
  loadEndpointManifests: mocks.loadEndpointManifests,
  loadPolicyRules: mocks.loadPolicyRules,
  loadOverrides: mocks.loadOverrides,
}));

import { runDeliberation, deliberationRun } from "./deliberation-run";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeAndCall.mockReset().mockResolvedValue({
    content: "RECOMMENDATION: accept\nRATIONALE: Evidence supports it.",
    providerId: "openai", modelId: "gpt-4o", inputTokens: 10, outputTokens: 20,
    truncated: false,
  });
  mocks.transaction.mockImplementation(async (callback: (client: unknown) => unknown) =>
    callback({
      taskRun: {
      update: mocks.taskRunUpdate,
      updateMany: mocks.taskRunUpdateMany,
      findUnique: mocks.taskRunFindUnique,
    },
      deliberationRun: {
        findUnique: mocks.deliberationRunFindUnique,
        update: mocks.deliberationRunUpdate,
      },
      taskNode: {
        update: mocks.taskNodeUpdate,
        findMany: mocks.taskNodeFindMany,
      },
      deliberationOutcome: { create: mocks.outcomeCreate, upsert: mocks.outcomeUpsert },
      deliberationIssueSet: {
        create: mocks.issueSetCreate,
        deleteMany: mocks.issueSetDeleteMany,
      },
      claimRecord: { create: mocks.claimCreate, deleteMany: mocks.claimDeleteMany },
    }),
  );
  mocks.taskRunUpdate.mockResolvedValue({});
  mocks.taskRunUpdateMany.mockResolvedValue({ count: 1 });
  mocks.taskRunFindUnique.mockResolvedValue({ routeContext: "deliberation" });
  mocks.deliberationRunUpdate.mockResolvedValue({});
  mocks.taskNodeUpdate.mockResolvedValue({});
  mocks.outcomeCreate.mockResolvedValue({});
  mocks.outcomeUpsert.mockResolvedValue({});
  mocks.issueSetCreate.mockResolvedValue({});
  mocks.issueSetDeleteMany.mockResolvedValue({ count: 0 });
  mocks.claimDeleteMany.mockResolvedValue({ count: 0 });
  mocks.pushThreadProgress.mockResolvedValue(undefined);
  mocks.extractRoleRecipes.mockReturnValue(new Map());
  mocks.getPattern.mockResolvedValue({
    patternId: "p1",
    slug: "review",
    name: "Peer Review",
    status: "active",
    purpose: "",
    defaultRoles: [],
    topologyTemplate: {},
    activationPolicyHints: {},
    evidenceRequirements: {},
    outputContract: {},
    providerStrategyHints: {},
    source: "db",
  });
  mocks.loadEndpointManifests.mockResolvedValue([
    { id: "ep1", providerId: "openai", modelId: "gpt-4o" },
  ]);
  mocks.loadPolicyRules.mockResolvedValue([]);
  mocks.loadOverrides.mockResolvedValue([]);
  mocks.routeEndpointV2.mockResolvedValue({
    selectedEndpoint: "ep1",
    selectedModelId: "gpt-4o",
    reason: "ok",
    fitnessScore: 0.9,
    fallbackChain: [],
    candidates: [],
    excludedCount: 0,
    excludedReasons: [],
    policyRulesApplied: [],
    taskType: "review",
    sensitivity: "internal",
    timestamp: new Date(),
  });
  mocks.taskNodeFindMany.mockResolvedValue([]);
});

function runWithBranches(
  branches: Array<{
    id: string;
    workerRole: string;
    status: string;
    outputSnapshot?: Record<string, unknown>;
  }>,
  strategyProfile = "balanced",
  diversityMode = "single-model-multi-persona",
  budgetUsd: number | null = null,
) {
  mocks.deliberationRunFindUnique.mockResolvedValue({
    id: "delib-1",
    artifactType: "code-change",
    strategyProfile,
    diversityMode,
    budgetUsd,
    pattern: { slug: "review", providerStrategyHints: {} },
    branchNodes: branches.map((b) => ({
      id: b.id,
      workerRole: b.workerRole,
      status: b.status,
      routeDecision: null,
      outputSnapshot: b.outputSnapshot ?? null,
    })),
  });
  // Synthesizer's downstream read — return completed non-summarizer branches.
  mocks.taskNodeFindMany.mockResolvedValue(
    branches
      .filter((b) => b.workerRole !== "summarizer")
      .map((b) => ({
        id: b.id,
        workerRole: b.workerRole,
        status: b.status === "completed" ? "completed" : "completed",
      })),
  );
}

describe("runDeliberation", () => {
  it("retains incomplete call cost on resume without rerunning that branch", async () => {
    runWithBranches([
      { id: "failed", workerRole: "reviewer", status: "failed", outputSnapshot: {
        error: "incomplete-answer", raw: "partial", inputTokens: 10000, outputTokens: 10000,
      } },
      { id: "waiting", workerRole: "reviewer", status: "queued" },
    ], "balanced", "single-model-multi-persona", 0.001);
    await runDeliberation({ userId: "u1", deliberationRunId: "delib-1", taskRunId: "tr-1", threadId: null, resume: true });
    expect(mocks.routeAndCall).not.toHaveBeenCalled();
    expect(mocks.taskNodeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "waiting" }, data: expect.objectContaining({ status: "cancelled" }),
    }));
    expect(mocks.deliberationRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { metadata: expect.objectContaining({ budgetHalted: true, capacityWaitExhausted: false }) },
    }));
  });
  it("rehydrates completed positions and preserves the brief on resume", async () => {
    runWithBranches([{ id: "n1", workerRole: "reviewer", status: "completed", outputSnapshot: {
      raw: "RECOMMENDATION: accept\nRATIONALE: Prior evidence.", providerId: "openai", modelId: "gpt-4o", inputTokens: 5, outputTokens: 5,
    } }]);
    const run = await mocks.deliberationRunFindUnique();
    run.metadata = { brief: "Keep this brief", subject: "Test", capacityDeferred: true };
    await runDeliberation({ userId: "u1", deliberationRunId: "delib-1", taskRunId: "tr-1", threadId: null, resume: true });
    expect(mocks.routeAndCall).not.toHaveBeenCalled();
    expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ mergedRecommendation: expect.stringContaining("accept") }) }));
    expect(mocks.deliberationRunUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { metadata: expect.objectContaining({ brief: "Keep this brief", subject: "Test", capacityDeferred: false }) } }));
  });

  it("bounds durable capacity waits and parks without inventing an outcome", async () => {
    runWithBranches([{ id: "n1", workerRole: "reviewer", status: "queued" }]);
    const run = await mocks.deliberationRunFindUnique();
    run.metadata = { brief: "Original brief" };
    mocks.routeAndCall.mockRejectedValue(Object.assign(new Error("busy"), { name: "LocalProviderCapacityDeferredError", reason: "local-runner-busy" }));
    const step = { run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()), sleep: vi.fn().mockResolvedValue(undefined) };
    const handler = deliberationRun as unknown as (input: { event: { name: string; data: Record<string, unknown> }; step: typeof step }) => Promise<unknown>;
    await expect(handler({ event: { name: "deliberation/run.start", data: { userId: "u1", deliberationRunId: "delib-1", taskRunId: "tr-1", threadId: null } }, step })).resolves.toEqual({ ok: false, deferredCapacity: true });
    expect(step.sleep).toHaveBeenCalledTimes(10);
    expect(mocks.outcomeUpsert).not.toHaveBeenCalled();
    expect(mocks.taskRunUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "input-required" }) }));
    expect(mocks.deliberationRunUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { metadata: expect.objectContaining({ brief: "Original brief", capacityWaitExhausted: true }) } }));
  });

  it("keeps capacity-deferred branches queued and does not seal a verdict", async () => {
    runWithBranches([{ id: "n1", workerRole: "reviewer", status: "queued" }]);
    const busy = Object.assign(new Error("Local provider dispatch deferred: local-runner-busy"), {
      name: "LocalProviderCapacityDeferredError", reason: "local-runner-busy",
    });
    mocks.routeAndCall.mockRejectedValueOnce(busy);
    const result = await runDeliberation({ userId: "u1", deliberationRunId: "delib-1", taskRunId: "tr-1", threadId: "th-1" });
    expect(result).toMatchObject({ deferredCapacity: true });
    expect(mocks.taskNodeUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "queued", completedAt: null }) }));
    expect(mocks.outcomeUpsert).not.toHaveBeenCalled();
    expect(mocks.pushThreadProgress.mock.calls.map(c => c[2].type)).not.toContain("deliberation:completed");
  });

  it.each([true, false])("does not accept an incomplete answer (truncated=%s)", async truncated => {
    runWithBranches([{ id: "n1", workerRole: "reviewer", status: "queued" }]);
    mocks.routeAndCall.mockResolvedValueOnce({ content: truncated ? "RECOMMENDATION: acc" : "", truncated, providerId: "local", modelId: "qwen", inputTokens: 10, outputTokens: 4096 });
    await runDeliberation({ userId: "u1", deliberationRunId: "delib-1", taskRunId: "tr-1", threadId: "th-1" });
    expect(mocks.taskNodeUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", outputSnapshot: expect.objectContaining({ error: "incomplete-answer" }) }) }));
    expect(mocks.taskNodeUpdate.mock.calls.some(c => c[0].where.id === "n1" && c[0].data.status === "completed")).toBe(false);
  });

  it("emits queued → branch_dispatched → branch_completed → completed", async () => {
    runWithBranches([
      { id: "n1", workerRole: "reviewer", status: "queued" },
      { id: "n2", workerRole: "reviewer", status: "queued" },
      { id: "n3", workerRole: "summarizer", status: "queued" },
    ]);

    await runDeliberation({
      userId: "u1",
      deliberationRunId: "delib-1",
      taskRunId: "tr-1",
      threadId: "th-1",
    });

    const eventTypes = mocks.pushThreadProgress.mock.calls.map(
      (c) => (c[2] as { type: string }).type,
    );
    expect(eventTypes).toContain("deliberation:queued");
    expect(eventTypes.filter((t) => t === "deliberation:branch_dispatched")).toHaveLength(2);
    expect(eventTypes.filter((t) => t === "deliberation:branch_completed")).toHaveLength(2);
    expect(eventTypes).toContain("deliberation:completed");
  });

  it("does not redispatch branches already marked completed (resume)", async () => {
    runWithBranches([
      { id: "n1", workerRole: "reviewer", status: "completed" },
      { id: "n2", workerRole: "reviewer", status: "queued" },
      { id: "n3", workerRole: "summarizer", status: "queued" },
    ]);

    await runDeliberation({
      userId: "u1",
      deliberationRunId: "delib-1",
      taskRunId: "tr-1",
      threadId: "th-1",
      resume: true,
    });

    // routeEndpointV2 should be called only for the non-completed worker.
    expect(mocks.routeEndpointV2).toHaveBeenCalledTimes(1);
  });

  it("records actualDiversity=constrained when routing returns the same provider", async () => {
    runWithBranches(
      [
        { id: "n1", workerRole: "reviewer", status: "queued" },
        { id: "n2", workerRole: "reviewer", status: "queued" },
        { id: "n3", workerRole: "summarizer", status: "queued" },
      ],
      "high-assurance",
      "multi-provider-heterogeneous",
    );

    await runDeliberation({
      userId: "u1",
      deliberationRunId: "delib-1",
      taskRunId: "tr-1",
      threadId: "th-1",
    });

    // Both branches got the same provider (openai) because
    // routeEndpointV2 mock always picks ep1 — actualDiversity should be
    // "constrained".
    const updates = mocks.deliberationRunUpdate.mock.calls;
    const metadataUpdate = updates.find((c) => c[0].data.metadata);
    expect(metadataUpdate).toBeDefined();
    expect(
      (metadataUpdate![0].data.metadata as Record<string, unknown>).actualDiversity,
    ).toBe("constrained");

    // A deliberation:degraded_diversity event was emitted.
    const events = mocks.pushThreadProgress.mock.calls.map(
      (c) => (c[2] as { type: string }).type,
    );
    expect(events).toContain("deliberation:degraded_diversity");
  });

  it("marks TaskRun completed when routeContext is deliberation", async () => {
    runWithBranches([
      { id: "n1", workerRole: "reviewer", status: "queued" },
      { id: "n2", workerRole: "summarizer", status: "queued" },
    ]);

    await runDeliberation({
      userId: "u1",
      deliberationRunId: "delib-1",
      taskRunId: "tr-1",
      threadId: "th-1",
    });

    // First call sets active, second completes.
    const updates = mocks.taskRunUpdate.mock.calls;
    const completedUpdate = updates.find(
      (c) => c[0].data.status === "completed",
    );
    expect(completedUpdate).toBeDefined();
  });

  it("completes an orchestrator-bootstrapped TaskRun even when routeContext is /build (BI-D208E70C)", async () => {
    runWithBranches([
      { id: "n1", workerRole: "reviewer", status: "queued" },
      { id: "n2", workerRole: "summarizer", status: "queued" },
    ]);
    mocks.taskRunFindUnique.mockResolvedValue({ routeContext: "/build" });

    await runDeliberation({
      userId: "u1",
      deliberationRunId: "delib-1",
      taskRunId: "deliberation-1788372027063-9vjla0",
      threadId: null,
    });

    const completedUpdate = mocks.taskRunUpdate.mock.calls.find(
      (c) => c[0].data.status === "completed",
    );
    expect(completedUpdate).toBeDefined();
    // The start-of-run transition is the guarded one, never a bare update to working.
    expect(mocks.taskRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "working" }) }),
    );
    expect(
      mocks.taskRunUpdate.mock.calls.find((c) => c[0].data.status === "working"),
    ).toBeUndefined();
  });

  it("does not complete a caller-owned TaskRun whose routeContext is not deliberation", async () => {
    runWithBranches([
      { id: "n1", workerRole: "reviewer", status: "queued" },
      { id: "n2", workerRole: "summarizer", status: "queued" },
    ]);
    mocks.taskRunFindUnique.mockResolvedValue({ routeContext: "/build" });

    await runDeliberation({
      userId: "u1",
      deliberationRunId: "delib-1",
      taskRunId: "TR-CALLER-OWNED",
      threadId: null,
    });

    expect(
      mocks.taskRunUpdate.mock.calls.find((c) => c[0].data.status === "completed"),
    ).toBeUndefined();
  });

  it("returns early when DeliberationRun doesn't exist — no crash", async () => {
    mocks.deliberationRunFindUnique.mockResolvedValue(null);
    await runDeliberation({
      userId: "u1",
      deliberationRunId: "missing",
      taskRunId: "tr-1",
      threadId: "th-1",
    });
    // No branch dispatch calls.
    expect(mocks.routeEndpointV2).not.toHaveBeenCalled();
    // No outcome persisted.
    expect(mocks.outcomeCreate).not.toHaveBeenCalled();
  });

  it("marks branch failed when routeEndpointV2 returns no selectedEndpoint", async () => {
    runWithBranches([
      { id: "n1", workerRole: "reviewer", status: "queued" },
      { id: "n2", workerRole: "summarizer", status: "queued" },
    ]);
    mocks.routeEndpointV2.mockResolvedValueOnce({
      selectedEndpoint: null,
      selectedModelId: null,
      reason: "no endpoints",
      fitnessScore: 0,
      fallbackChain: [],
      candidates: [],
      excludedCount: 0,
      excludedReasons: [],
      policyRulesApplied: [],
      taskType: "review",
      sensitivity: "internal",
      timestamp: new Date(),
    });

    await runDeliberation({
      userId: "u1",
      deliberationRunId: "delib-1",
      taskRunId: "tr-1",
      threadId: "th-1",
    });

    const events = mocks.pushThreadProgress.mock.calls.map((c) => c[2]);
    const completionEvents = events.filter(
      (e) => (e as { type: string }).type === "deliberation:branch_completed",
    );
    expect(completionEvents[0]).toMatchObject({ success: false });
  });
});
