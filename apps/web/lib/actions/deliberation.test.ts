// apps/web/lib/actions/deliberation.test.ts
// Task 7 — Server-action / MCP-tool surface for deliberation.
//
// Covers:
//   - startDeliberation creates a DeliberationRun and returns the runId
//   - getDeliberationStatus returns consensusState + branch counts +
//     evidence coverage
//   - getDeliberationOutcome returns the full outcome + claim/evidence refs
//   - autoApproveWhen predicate admits stage-default and risk-escalated
//     invocations (pre-authorized) but defers explicit invocations
//   - startDeliberation refuses when the requested tool authority exceeds
//     the parent TaskRun.authorityScope
//
// Uses hoisted vi.mock for Prisma + activation resolver + orchestrator.
// No live DB, no live inngest — pure logic under test.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  // Prisma
  taskRunFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  deliberationRunFindUnique: vi.fn(),
  deliberationOutcomeFindUnique: vi.fn(),
  deliberationIssueSetFindFirst: vi.fn(),
  claimRecordFindMany: vi.fn(),
  evidenceBundleFindMany: vi.fn(),
  // Activation + orchestrator
  activationResolve: vi.fn(),
  orchestrate: vi.fn(),
  inngestSend: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique: mocks.taskRunFindUnique },
    user: { findUnique: mocks.userFindUnique },
    deliberationRun: { findUnique: mocks.deliberationRunFindUnique },
    deliberationOutcome: { findUnique: mocks.deliberationOutcomeFindUnique },
    deliberationIssueSet: { findFirst: mocks.deliberationIssueSetFindFirst },
    claimRecord: { findMany: mocks.claimRecordFindMany },
    evidenceBundle: { findMany: mocks.evidenceBundleFindMany },
  },
}));

vi.mock("../deliberation/activation", () => ({
  resolve: mocks.activationResolve,
}));

vi.mock("../deliberation/orchestrator", () => ({
  orchestrateDeliberation: mocks.orchestrate,
}));

vi.mock("../queue/inngest-client", () => ({
  inngest: { send: mocks.inngestSend },
}));

import {
  startDeliberation,
  getDeliberationStatus,
  getDeliberationOutcome,
  startDeliberationAutoApprove,
} from "./deliberation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindUnique.mockResolvedValue({
    id: "user-1",
    isSuperuser: false,
  });
  // Default: parent TaskRun owned by user-1 with authorityScope=["read"].
  mocks.taskRunFindUnique.mockResolvedValue({
    id: "task-run-db-id",
    taskRunId: "TR-1",
    userId: "user-1",
    authorityScope: ["read"],
  });
  mocks.activationResolve.mockResolvedValue({
    patternSlug: "review",
    triggerSource: "stage",
    strategyProfile: "balanced",
    diversityMode: "single-model-multi-persona",
    activatedRiskLevel: null,
    reason: "Peer review is the default for the plan stage.",
  });
  mocks.orchestrate.mockResolvedValue({
    deliberationRunId: "del-1",
    taskRunId: "TR-1",
    taskRunBootstrapped: false,
    branches: [
      {
        branchNodeId: "n1",
        role: "author",
        status: "queued",
        providerId: null,
        modelId: null,
        authorityEnvelope: ["read"],
      },
      {
        branchNodeId: "n2",
        role: "reviewer",
        status: "queued",
        providerId: null,
        modelId: null,
        authorityEnvelope: ["read"],
      },
    ],
    requestedDiversity: "single-model-multi-persona",
    actualDiversity: "single-model-multi-persona",
    budgetHalted: false,
    branchBudgetUsed: 0,
  });
  mocks.inngestSend.mockResolvedValue({ ids: ["evt-1"] });
});

/* -------------------------------------------------------------------------- */
/* startDeliberation                                                          */
/* -------------------------------------------------------------------------- */

describe("startDeliberation", () => {
  it("creates a DeliberationRun and returns the id + trigger source + reason", async () => {
    const result = await startDeliberation({
      userId: "user-1",
      patternSlug: "review",
      taskRunId: "TR-1",
      artifactType: "spec",
      stage: "plan",
      riskLevel: "low",
    });

    expect(result.deliberationRunId).toBe("del-1");
    expect(result.triggerSource).toBe("stage");
    expect(result.reason).toMatch(/peer review/i);

    expect(mocks.activationResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "plan",
        riskLevel: "low",
        explicitPatternSlug: "review",
        artifactType: "spec",
      }),
    );
    expect(mocks.orchestrate).toHaveBeenCalled();
    // Dispatched to the async runner.
    expect(mocks.inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: "deliberation/run.start" }),
    );
  });

  it("fails loudly when the user is unauthorized (no row)", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);
    await expect(
      startDeliberation({
        userId: "ghost",
        patternSlug: "review",
        artifactType: "spec",
      }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("fails when the parent TaskRun is owned by a different user and caller is not superuser", async () => {
    mocks.taskRunFindUnique.mockResolvedValueOnce({
      id: "task-run-db-id",
      taskRunId: "TR-X",
      userId: "someone-else",
      authorityScope: ["read"],
    });
    await expect(
      startDeliberation({
        userId: "user-1",
        patternSlug: "review",
        taskRunId: "TR-X",
        artifactType: "spec",
      }),
    ).rejects.toThrow(/not authorized/i);
  });

  it("allows a superuser to start a deliberation on another user's TaskRun", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: "admin-1",
      isSuperuser: true,
    });
    mocks.taskRunFindUnique.mockResolvedValueOnce({
      id: "task-run-db-id",
      taskRunId: "TR-X",
      userId: "someone-else",
      authorityScope: ["read"],
    });
    const result = await startDeliberation({
      userId: "admin-1",
      patternSlug: "review",
      taskRunId: "TR-X",
      artifactType: "spec",
    });
    expect(result.deliberationRunId).toBe("del-1");
  });

  it("fails when activation resolver returns null", async () => {
    mocks.activationResolve.mockResolvedValueOnce(null);
    await expect(
      startDeliberation({
        userId: "user-1",
        patternSlug: "nope-not-real",
        artifactType: "spec",
      }),
    ).rejects.toThrow(/activation declined|no deliberation/i);
  });

  it("refuses when the requested tool authority exceeds parent authority scope", async () => {
    // Parent TaskRun has only ["read"]. The caller tries to request a
    // deliberation whose role declares a privileged capability.
    mocks.taskRunFindUnique.mockResolvedValueOnce({
      id: "task-run-db-id",
      taskRunId: "TR-1",
      userId: "user-1",
      authorityScope: ["read"],
    });
    await expect(
      startDeliberation({
        userId: "user-1",
        patternSlug: "review",
        taskRunId: "TR-1",
        artifactType: "spec",
        // Caller asks for a scope beyond what the parent has — must refuse.
        requestedAuthorityScope: ["read", "write:code"],
      }),
    ).rejects.toThrow(/authority/i);
  });

  it("bootstraps a TaskRun when no taskRunId is supplied", async () => {
    const result = await startDeliberation({
      userId: "user-1",
      patternSlug: "review",
      artifactType: "spec",
    });
    expect(result.deliberationRunId).toBe("del-1");
    // Orchestrator is called with no taskRunId — orchestrator owns bootstrap.
    const call = mocks.orchestrate.mock.calls[0][0] as { taskRunId?: string };
    expect(call.taskRunId ?? null).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* getDeliberationStatus                                                      */
/* -------------------------------------------------------------------------- */

describe("getDeliberationStatus", () => {
  it("returns consensusState, branch counts, and evidence coverage", async () => {
    mocks.deliberationRunFindUnique.mockResolvedValueOnce({
      id: "del-1",
      consensusState: "pending",
      metadata: { budgetHalted: false, actualDiversity: "single-model-multi-persona" },
      taskRun: { userId: "user-1" },
      branchNodes: [
        { id: "n1", status: "completed" },
        { id: "n2", status: "running" },
        { id: "n3", status: "failed" },
        { id: "n4", status: "queued" },
      ],
    });
    mocks.claimRecordFindMany.mockResolvedValueOnce([
      { evidenceGrade: "A" },
      { evidenceGrade: "A" },
      { evidenceGrade: "B" },
      { evidenceGrade: "C" },
      { evidenceGrade: "D" },
    ]);

    const result = await getDeliberationStatus({
      deliberationRunId: "del-1",
      userId: "user-1",
    });

    expect(result.consensusState).toBe("pending");
    expect(result.branchCounts).toEqual({
      total: 4,
      completed: 1,
      failed: 1,
      pending: 2, // running + queued
    });
    // Badge is derived from grade mix — A/B-dominant mixes should not collapse
    // into needs-more-evidence; ensure the shape is present.
    expect(result.evidenceCoverage).toHaveProperty("sourceBacked");
    expect(result.evidenceCoverage).toHaveProperty("mixed");
    expect(result.evidenceCoverage).toHaveProperty("needsMoreEvidence");
    expect(result.budgetHalted).toBe(false);
    expect(result.degradedDiversity).toBe(false);
  });

  it("throws when run is not found", async () => {
    mocks.deliberationRunFindUnique.mockResolvedValueOnce(null);
    await expect(
      getDeliberationStatus({ deliberationRunId: "ghost", userId: "user-1" }),
    ).rejects.toThrow(/not found/i);
  });

  it("throws when the caller does not own the parent TaskRun", async () => {
    mocks.deliberationRunFindUnique.mockResolvedValueOnce({
      id: "del-1",
      consensusState: "pending",
      metadata: {},
      taskRun: { userId: "someone-else" },
      branchNodes: [],
    });
    await expect(
      getDeliberationStatus({ deliberationRunId: "del-1", userId: "user-1" }),
    ).rejects.toThrow(/not authorized/i);
  });

  it("reports budgetHalted + degradedDiversity from metadata", async () => {
    mocks.deliberationRunFindUnique.mockResolvedValueOnce({
      id: "del-2",
      consensusState: "partial-consensus",
      metadata: {
        budgetHalted: true,
        actualDiversity: "constrained",
        requestedDiversity: "multi-provider-heterogeneous",
      },
      taskRun: { userId: "user-1" },
      branchNodes: [{ id: "n1", status: "completed" }],
    });
    mocks.claimRecordFindMany.mockResolvedValueOnce([]);

    const result = await getDeliberationStatus({
      deliberationRunId: "del-2",
      userId: "user-1",
    });
    expect(result.budgetHalted).toBe(true);
    expect(result.degradedDiversity).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* getDeliberationOutcome                                                     */
/* -------------------------------------------------------------------------- */

describe("getDeliberationOutcome", () => {
  it("returns null outcome when synthesis has not yet completed", async () => {
    mocks.deliberationRunFindUnique.mockResolvedValueOnce({
      id: "del-1",
      taskRun: { userId: "user-1" },
    });
    mocks.deliberationOutcomeFindUnique.mockResolvedValueOnce(null);
    mocks.deliberationIssueSetFindFirst.mockResolvedValueOnce(null);
    mocks.claimRecordFindMany.mockResolvedValueOnce([]);
    mocks.evidenceBundleFindMany.mockResolvedValueOnce([]);

    const result = await getDeliberationOutcome({
      deliberationRunId: "del-1",
      userId: "user-1",
    });

    expect(result.outcome).toBeNull();
    expect(result.issueSet).toBeNull();
    expect(result.claims).toEqual([]);
    expect(result.evidenceBundles).toEqual([]);
  });

  it("returns the full outcome with compact claim + evidence refs", async () => {
    mocks.deliberationRunFindUnique.mockResolvedValueOnce({
      id: "del-1",
      taskRun: { userId: "user-1" },
    });
    mocks.deliberationOutcomeFindUnique.mockResolvedValueOnce({
      id: "outcome-1",
      deliberationRunId: "del-1",
      mergedRecommendation: "Ship with monitoring.",
      rationaleSummary: "All branches agreed.",
      confidence: 0.9,
      consensusState: "consensus",
      evidenceQuality: "source-backed",
      unresolvedRisks: [],
      diversityLabel: "Multi-persona review",
      branchRoster: [{ branchNodeId: "n1", role: "author", completed: true }],
    });
    mocks.deliberationIssueSetFindFirst.mockResolvedValueOnce({
      id: "iset-1",
      deliberationRunId: "del-1",
      assertions: [{ claimId: "c1" }],
      objections: [],
      rebuttals: [],
      adjudicationNotes: "All branches completed.",
    });
    mocks.claimRecordFindMany.mockResolvedValueOnce([
      {
        id: "c1",
        claimType: "assertion",
        claimText: "Feature meets spec.",
        status: "supported",
        evidenceGrade: "A",
        confidence: 0.95,
        branchNodeId: "n1",
      },
    ]);
    mocks.evidenceBundleFindMany.mockResolvedValueOnce([
      {
        id: "bundle-1",
        summary: "Spec excerpts",
        sources: [{ id: "src-1" }, { id: "src-2" }],
      },
    ]);

    const result = await getDeliberationOutcome({
      deliberationRunId: "del-1",
      userId: "user-1",
    });

    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.mergedRecommendation).toBe("Ship with monitoring.");
    expect(result.outcome!.consensusState).toBe("consensus");
    expect(result.issueSet).not.toBeNull();
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]).toMatchObject({
      claimId: "c1",
      claimType: "assertion",
      evidenceGrade: "A",
    });
    expect(result.evidenceBundles).toHaveLength(1);
    expect(result.evidenceBundles[0]).toMatchObject({
      bundleId: "bundle-1",
      sourceCount: 2,
    });
    // Evidence bundle DTOs must NOT carry full source rows — just the count.
    expect(result.evidenceBundles[0]).not.toHaveProperty("sources");
  });

  it("refuses when caller does not own the parent TaskRun", async () => {
    mocks.deliberationRunFindUnique.mockResolvedValueOnce({
      id: "del-1",
      taskRun: { userId: "someone-else" },
    });
    await expect(
      getDeliberationOutcome({ deliberationRunId: "del-1", userId: "user-1" }),
    ).rejects.toThrow(/not authorized/i);
  });
});

/* -------------------------------------------------------------------------- */
/* autoApproveWhen predicate                                                  */
/* -------------------------------------------------------------------------- */

describe("startDeliberationAutoApprove predicate", () => {
  it("auto-approves stage-default invocations", async () => {
    const ok = await startDeliberationAutoApprove({
      userId: "user-1",
      params: {
        patternSlug: "review",
        artifactType: "spec",
        triggerSource: "stage",
      },
    });
    expect(ok).toBe(true);
  });

  it("auto-approves risk-escalated invocations", async () => {
    const ok = await startDeliberationAutoApprove({
      userId: "user-1",
      params: {
        patternSlug: "debate",
        artifactType: "architecture-decision",
        triggerSource: "risk",
      },
    });
    expect(ok).toBe(true);
  });

  it("defers explicit invocations to proposal review", async () => {
    const ok = await startDeliberationAutoApprove({
      userId: "user-1",
      params: {
        patternSlug: "debate",
        artifactType: "architecture-decision",
        triggerSource: "explicit",
      },
    });
    expect(ok).toBe(false);
  });

  it("defers when params are missing or malformed", async () => {
    const ok = await startDeliberationAutoApprove({
      userId: "user-1",
      params: {},
    });
    expect(ok).toBe(false);
  });
});
