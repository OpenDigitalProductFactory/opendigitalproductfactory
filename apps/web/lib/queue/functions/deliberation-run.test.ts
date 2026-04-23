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
  taskRunUpdate: vi.fn(),
  taskRunFindUnique: vi.fn(),
  deliberationRunFindUnique: vi.fn(),
  deliberationRunUpdate: vi.fn(),
  taskNodeUpdate: vi.fn(),
  taskNodeFindMany: vi.fn(),
  outcomeCreate: vi.fn(),
  issueSetCreate: vi.fn(),
  claimCreate: vi.fn(),
  pushThreadProgress: vi.fn(),
  getPattern: vi.fn(),
  extractRoleRecipes: vi.fn(),
  routeEndpointV2: vi.fn(),
  loadEndpointManifests: vi.fn(),
  loadPolicyRules: vi.fn(),
  loadOverrides: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { update: mocks.taskRunUpdate, findUnique: mocks.taskRunFindUnique },
    deliberationRun: {
      findUnique: mocks.deliberationRunFindUnique,
      update: mocks.deliberationRunUpdate,
    },
    taskNode: {
      update: mocks.taskNodeUpdate,
      findMany: mocks.taskNodeFindMany,
    },
    deliberationOutcome: { create: mocks.outcomeCreate },
    deliberationIssueSet: { create: mocks.issueSetCreate },
    claimRecord: { create: mocks.claimCreate },
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

import { runDeliberation } from "./deliberation-run";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.taskRunUpdate.mockResolvedValue({});
  mocks.taskRunFindUnique.mockResolvedValue({ routeContext: "deliberation" });
  mocks.deliberationRunUpdate.mockResolvedValue({});
  mocks.taskNodeUpdate.mockResolvedValue({});
  mocks.outcomeCreate.mockResolvedValue({});
  mocks.issueSetCreate.mockResolvedValue({});
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
