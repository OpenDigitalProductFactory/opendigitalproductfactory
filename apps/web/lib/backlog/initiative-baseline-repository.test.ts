import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveArtifact: vi.fn(),
  writeBlob: vi.fn(),
  transaction: vi.fn(),
  activityCreate: vi.fn(),
  documentCreate: vi.fn(),
  pinCreate: vi.fn(),
  backlogItemFind: vi.fn(),
  authorizationDecisionFind: vi.fn(),
  organizationFind: vi.fn(),
}));

vi.mock("@/lib/documents/blob-storage", () => ({ writeDocumentBlob: mocks.writeBlob }));
vi.mock("./initiative-readiness/artifact-resolver", () => ({ resolveInitiativeArtifact: mocks.resolveArtifact }));
vi.mock("@dpf/db", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  prisma: {
    backlogItem: {
      findUnique: mocks.backlogItemFind,
    },
    authorizationDecisionLog: {
      findUnique: mocks.authorizationDecisionFind,
    },
    organization: {
      findFirst: mocks.organizationFind,
    },
    principalAlias: {
      findMany: vi.fn(async () => [{ principal: { principalId: "principal-reviewer" } }]),
    },
    $transaction: mocks.transaction,
  },
}));

import { recordInitiativeSpecApproval } from "./initiative-readiness/baseline-repository";
import { recordInitiativeGateReceipt } from "./initiative-readiness/receipt-repository";
import { createHash } from "node:crypto";

const canonical = `**OBJ-TEST-001:** Preserve the approved objective.

| ID | Objectives | Criterion | Evidence |
| --- | --- | --- | --- |
| AC-TEST-001 | OBJ-TEST-001 | Completion proves the objective. | test |
`;
const locator = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: "a".repeat(40),
  path: "docs/superpowers/specs/test.md",
  providerBlobId: "b".repeat(40),
};

const boundTask = { taskRunId: "TR-MCP-SPEC-BOUND", requestDigest: "9".repeat(64), executionFence: {
  schemaVersion: 1 as const, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest: "9".repeat(64),
} };
const boundApproval = { itemId: "BI-TEST", profile: "feature" as const, artifactRole: "design-spec" as const,
  artifactRef: locator, expectedCurrentBaselineId: null, supersessionDispositions: [], resolvedFindingRefs: [],
  reason: "Independent review.", reviewerUserId: "user-reviewer", reviewerAgentId: "agent-reviewer",
  authorityDecisionId: "decision-1", tokenScope: "write", boundReviewTask: boundTask };

function tx() {
  return {
    $queryRaw: vi.fn(async () => []),
    backlogItem: {
      findUnique: vi.fn(async () => ({
        organizationId: "org-1",
        type: "feature",
        source: null,
        workType: null,
        scopeKind: null,
        archetypeCategories: [],
      archetypeIds: [],
      activeBuild: null,
      featureBuilds: [],
      })),
    },
    organization: { findFirst: mocks.organizationFind },
    backlogItemActivity: {
      findMany: vi.fn(async () => []),
      create: mocks.activityCreate.mockImplementation(async ({ data }) => data),
    },
    documentBlob: { upsert: vi.fn(async () => ({ id: "blob-1", storageKey: "documents/sha256/provider", sizeBytes: canonical.length })) },
    document: {
      create: mocks.documentCreate.mockImplementation(async () => ({ id: "doc-row" })),
      update: vi.fn(async () => ({ id: "doc-row" })),
    },
    documentVersion: { create: vi.fn(async () => ({ id: "version-1" })) },
    initiativeArtifactRetentionPin: {
      create: mocks.pinCreate.mockImplementation(async ({ data }) => data),
    },
  };
}

function boundPublication() {
  const digest = createHash("sha256").update(canonical).digest("hex");
  type Activity = { id: string; backlogItemId: string; kind: string; gateKey?: string; payload: Record<string, unknown> };
  const activities: Activity[] = [];
  const pins: Record<string, unknown>[] = [];
  mocks.resolveArtifact.mockResolvedValue({ ok: true, artifact: { ref: locator, digest: `sha256:${digest}`,
    authorPrincipalId: "principal-author", authorAgentId: "agent-author", bytes: Buffer.from(canonical) } });
  mocks.writeBlob.mockResolvedValue({ sha256: digest, storageKey: "documents/sha256/provider", sizeBytes: canonical.length });
  mocks.authorizationDecisionFind.mockImplementation(async ({ where }: { where: { decisionId: string } }) => ({
    decisionId: where.decisionId, decision: "allow", actionKey: "record_initiative_design_review",
    policyVersion: "authority-v1", organizationId: "org-1", rationale: { taskRunId: boundTask.taskRunId },
  }));
  const task = { id: "task-row", taskRunId: boundTask.taskRunId, userId: boundApproval.reviewerUserId,
    currentAgentId: boundApproval.reviewerAgentId, status: "working", progressPayload: {} as Record<string, unknown>, a2aMetadata: {
      trigger: "external-mcp", requestDigest: boundTask.requestDigest, initiativeReviewBinding: {
        writerToolName: "record_initiative_design_review", itemId: boundApproval.itemId, gate: "spec-approval",
        artifactRef: locator, expectedCurrentBaselineId: null,
      },
    } };
  const base = tx();
  const db = { ...base, taskRun: { findUnique: vi.fn(async () => task) },
    authorizationDecisionLog: { findUnique: mocks.authorizationDecisionFind },
    coworkerActionEnvelope: { findMany: vi.fn(async () => []) },
    backlogItemActivity: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => activities.find((row) => row.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where?: { kind?: string; gateKey?: string } }) => activities.filter((row) =>
        (!where?.kind || row.kind === where.kind) && (!where?.gateKey || row.gateKey === where.gateKey))),
      create: mocks.activityCreate.mockImplementation(async ({ data }: { data: Activity }) => {
        activities.push(structuredClone(data)); return data;
      }),
    },
    initiativeArtifactRetentionPin: {
      create: mocks.pinCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => { pins.push(data); return data; }),
      findUnique: vi.fn(async ({ where }: { where: { baselineActivityId: string } }) =>
        pins.find((pin) => pin.baselineActivityId === where.baselineActivityId) ?? null),
    },
  };
  mocks.transaction.mockImplementation(async (work) => work(db));
  return { activities, pins, task, db };
}

describe("recordInitiativeSpecApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backlogItemFind.mockResolvedValue({
      id: "bi-row",
      itemId: "BI-TEST",
      title: "Test initiative",
      organizationId: "org-1",
      type: "feature",
      source: null,
      workType: null,
      scopeKind: null,
      archetypeCategories: [],
      archetypeIds: [],
      activeBuild: null,
      featureBuilds: [],
    });
    mocks.authorizationDecisionFind.mockResolvedValue({
      decisionId: "decision-1",
      decision: "allow",
      actionKey: "record_initiative_design_review",
      policyVersion: "authority-v1",
      organizationId: "org-1",
    });
    mocks.organizationFind.mockResolvedValue({ id: "org-storage" });
    mocks.resolveArtifact.mockResolvedValue({
      ok: true,
      artifact: {
        ref: locator,
        digest: "sha256:provider",
        authorPrincipalId: "principal-author",
        authorAgentId: "agent-author",
        bytes: Buffer.from(canonical),
      },
    });
    mocks.writeBlob.mockResolvedValue({ sha256: "provider", storageKey: "documents/sha256/provider", sizeBytes: canonical.length });
    mocks.transaction.mockImplementation(async (work) => work(tx()));
  });

  it("reuses the exact bound approval and retained baseline without archiving a second copy", async () => {
    const state = boundPublication();
    const first = await recordInitiativeSpecApproval(boundApproval);
    expect(first).toMatchObject({ ok: true });
    const second = await recordInitiativeSpecApproval({ ...boundApproval, authorityDecisionId: "decision-2" });
    expect(second).toMatchObject(first);
    expect(state.activities.filter((row) => row.kind === "initiative_scope_baseline")).toHaveLength(1);
    expect(mocks.documentCreate).toHaveBeenCalledOnce();
    expect(mocks.pinCreate).toHaveBeenCalledOnce();
  });

  it.each(["input-required", "completed", "failed"])("does not append a baseline for a %s task", async (status) => {
    const state = boundPublication();
    state.task.status = status;
    expect(await recordInitiativeSpecApproval(boundApproval)).toMatchObject({ ok: false });
    expect(state.activities).toHaveLength(0);
    expect(mocks.documentCreate).not.toHaveBeenCalled();
    expect(mocks.pinCreate).not.toHaveBeenCalled();
  });

  it.each(["uncertainty", "reservation", "dispatch", "authority"])("refuses a baseline after its execution %s changes", async (change) => {
    const state = boundPublication();
    if (change === "uncertainty") state.task.progressPayload.executionUncertainty = { settlement: "unknown" };
    if (change === "reservation") state.task.progressPayload.resumeReservedAt = "later";
    if (change === "dispatch") state.task.progressPayload.dispatch = { claimedAt: "later" };
    if (change === "authority") state.task.progressPayload.reviewExecutionAuthority = { schemaVersion: 1, tokenId: "later" };
    expect(await recordInitiativeSpecApproval(boundApproval)).toMatchObject({ ok: false });
    expect(state.activities).toHaveLength(0);
    expect(mocks.pinCreate).not.toHaveBeenCalled();
  });

  it("reads a genuine retained baseline after a task hold without creating another effect", async () => {
    const state = boundPublication();
    const first = await recordInitiativeSpecApproval(boundApproval);
    if (!first.ok) throw new Error("Expected an original retained baseline.");
    state.task.status = "input-required";
    state.task.progressPayload.executionUncertainty = { settlement: "unknown" };
    mocks.activityCreate.mockClear(); mocks.pinCreate.mockClear(); mocks.documentCreate.mockClear();
    expect(await recordInitiativeSpecApproval(boundApproval)).toMatchObject({ ok: true, baselineId: first.baselineId, deduplicated: true });
    expect(mocks.activityCreate).not.toHaveBeenCalled();
    expect(mocks.pinCreate).not.toHaveBeenCalled();
    expect(mocks.documentCreate).not.toHaveBeenCalled();
  });

  it("preserves a rejecting spec verdict instead of creating an approval baseline", async () => {
    const state = boundPublication();
    const rejected = await recordInitiativeGateReceipt({ ...boundApproval, allowedGates: ["spec-approval"],
      requiredCapability: "manage_backlog", requiredGrant: "initiative_design_review", actionKey: "record_initiative_design_review",
      gate: "spec-approval", decision: "fail", requiresIndependentReviewer: true,
      findings: [{ issue: "Acceptance is incomplete.", severity: "important" }],
    });
    if (!rejected.ok) throw new Error("Expected a canonical rejecting review.");
    const result = await recordInitiativeSpecApproval({ ...boundApproval, authorityDecisionId: "decision-2",
      resolvedFindingRefs: rejected.receipt.findingRefs as string[] });
    expect(result).toMatchObject({ ok: true, receiptId: rejected.receiptId, baselineId: null,
      deduplicated: true, receipt: { decision: "fail" } });
    expect(state.activities).toHaveLength(1);
    expect(mocks.documentCreate).not.toHaveBeenCalled();
    expect(mocks.pinCreate).not.toHaveBeenCalled();
  });

  it.each(["pin", "baseline", "cancellation"])("refuses an incomplete or changed bound %s winner", async (drift) => {
    const state = boundPublication();
    expect(await recordInitiativeSpecApproval(boundApproval)).toMatchObject({ ok: true });
    if (drift === "pin") state.pins.length = 0;
    if (drift === "baseline") state.activities.find((row) => row.kind === "initiative_scope_baseline")!.payload.artifactDigest = "sha256:foreign";
    if (drift === "cancellation") state.task.status = "canceled";
    mocks.activityCreate.mockClear();
    expect(await recordInitiativeSpecApproval({ ...boundApproval, authorityDecisionId: "decision-2" })).toMatchObject({ ok: false });
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("commits approval receipt, baseline, archive, and permanent pin through one serializable transaction", async () => {
    const result = await recordInitiativeSpecApproval({
      itemId: "BI-TEST",
      profile: "feature",
      artifactRole: "design-spec",
      artifactRef: locator,
      expectedCurrentBaselineId: null,
      supersessionDispositions: [],
      resolvedFindingRefs: [],
      reason: "Independent checklist review passed.",
      reviewerUserId: "user-reviewer",
      reviewerAgentId: "agent-reviewer",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    });

    expect(result).toMatchObject({ ok: true, artifactDigest: "sha256:provider" });
    expect(mocks.resolveArtifact).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transaction.mock.calls[0]![1]).toEqual({ isolationLevel: "Serializable" });
    expect(mocks.activityCreate).toHaveBeenCalledTimes(2);
    expect(mocks.activityCreate.mock.calls.map((call) => call[0].data.kind)).toEqual([
      "initiative_gate_receipt",
      "initiative_scope_baseline",
    ]);
    expect(mocks.pinCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceKind: "repository_blob_archive",
        documentVersionId: "version-1",
        documentBlobId: "blob-1",
      }),
    });
  });

  it("accepts a null tenant organization on the authority decision for a platform item", async () => {
    mocks.backlogItemFind.mockResolvedValueOnce({
      id: "bi-row",
      itemId: "BI-TEST",
      title: "Test initiative",
      organizationId: null,
      type: "feature",
      source: null,
      workType: null,
      scopeKind: null,
      archetypeCategories: [],
      archetypeIds: [],
      activeBuild: null,
      featureBuilds: [],
    });
    mocks.authorizationDecisionFind.mockResolvedValueOnce({
      decisionId: "decision-1",
      decision: "allow",
      actionKey: "record_initiative_design_review",
      policyVersion: "authority-v1",
      organizationId: null,
    });

    await expect(recordInitiativeSpecApproval({
      itemId: "BI-TEST",
      profile: "feature",
      artifactRole: "design-spec",
      artifactRef: locator,
      expectedCurrentBaselineId: null,
      supersessionDispositions: [],
      resolvedFindingRefs: [],
      reason: "Independent checklist review passed.",
      reviewerUserId: "user-reviewer",
      reviewerAgentId: "agent-reviewer",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: true, artifactDigest: "sha256:provider" });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.documentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-storage" }),
      select: { id: true },
    });
    expect(mocks.pinCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceKind: "repository_blob_archive",
        documentVersionId: "version-1",
        documentBlobId: "blob-1",
      }),
    });
  });

  it("rejects a real organization authority decision for an organizationless platform item", async () => {
    mocks.backlogItemFind.mockResolvedValueOnce({
      id: "bi-row",
      itemId: "BI-TEST",
      title: "Test initiative",
      organizationId: null,
      type: "feature",
      source: null,
      workType: null,
      scopeKind: null,
      archetypeCategories: [],
      archetypeIds: [],
      activeBuild: null,
      featureBuilds: [],
    });

    await expect(recordInitiativeSpecApproval({
      itemId: "BI-TEST",
      profile: "feature",
      artifactRole: "design-spec",
      artifactRef: locator,
      expectedCurrentBaselineId: null,
      supersessionDispositions: [],
      resolvedFindingRefs: [],
      reason: "Independent checklist review passed.",
      reviewerUserId: "user-reviewer",
      reviewerAgentId: "agent-reviewer",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: false, code: "AUTHORIZATION_DENIED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rolls back when the canonical artifact changes between resolution and the locked transaction", async () => {
    mocks.resolveArtifact
      .mockResolvedValueOnce({
        ok: true,
        artifact: { ref: locator, digest: "sha256:provider", authorPrincipalId: "principal-author", authorAgentId: "agent-author", bytes: Buffer.from(canonical) },
      })
      .mockResolvedValueOnce({
        ok: true,
        artifact: { ref: locator, digest: "sha256:changed", authorPrincipalId: "principal-author", authorAgentId: "agent-author", bytes: Buffer.from(canonical) },
      });
    await expect(recordInitiativeSpecApproval({
      itemId: "BI-TEST",
      profile: "feature",
      artifactRole: "design-spec",
      artifactRef: locator,
      expectedCurrentBaselineId: null,
      supersessionDispositions: [],
      resolvedFindingRefs: [],
      reason: "Independent checklist review passed.",
      reviewerUserId: "user-reviewer",
      reviewerAgentId: "agent-reviewer",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    expect(mocks.pinCreate).not.toHaveBeenCalled();
  });

  it("does not enter the approval transaction when archived bytes disagree with the provider digest", async () => {
    mocks.writeBlob.mockResolvedValue({ sha256: "different", storageKey: "documents/sha256/different", sizeBytes: canonical.length });
    await expect(recordInitiativeSpecApproval({
      itemId: "BI-TEST",
      profile: "feature",
      artifactRole: "design-spec",
      artifactRef: locator,
      expectedCurrentBaselineId: null,
      supersessionDispositions: [],
      resolvedFindingRefs: [],
      reason: "Independent checklist review passed.",
      reviewerUserId: "user-reviewer",
      reviewerAgentId: "agent-reviewer",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns a stable input-required result when permanent storage is unavailable", async () => {
    mocks.writeBlob.mockRejectedValue(new Error("storage unavailable"));
    await expect(recordInitiativeSpecApproval({
      itemId: "BI-TEST",
      profile: "feature",
      artifactRole: "design-spec",
      artifactRef: locator,
      expectedCurrentBaselineId: null,
      supersessionDispositions: [],
      resolvedFindingRefs: [],
      reason: "Independent checklist review passed.",
      reviewerUserId: "user-reviewer",
      reviewerAgentId: "agent-reviewer",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_REQUIRED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a plan or arbitrary repository file as the canonical scope baseline", async () => {
    await expect(recordInitiativeSpecApproval({
      itemId: "BI-TEST",
      profile: "feature",
      artifactRole: "design-spec",
      artifactRef: { ...locator, path: "docs/superpowers/plans/test.md" },
      expectedCurrentBaselineId: null,
      supersessionDispositions: [],
      resolvedFindingRefs: [],
      reason: "Independent checklist review passed.",
      reviewerUserId: "user-reviewer",
      reviewerAgentId: "agent-reviewer",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_REQUIRED" });
    expect(mocks.resolveArtifact).not.toHaveBeenCalled();
  });

  it("rejects a caller-selected profile below the strongest structured signal", async () => {
    const currentTx = tx();
    (currentTx.backlogItem as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn(async () => ({
      type: "feature",
      source: null,
      workType: null,
      scopeKind: "archetype",
      archetypeCategories: ["pet-services"],
      archetypeIds: ["veterinary-clinic"],
      activeBuild: null,
      featureBuilds: [],
    }));
    mocks.transaction.mockImplementationOnce(async (work) => work(currentTx));
    await expect(recordInitiativeSpecApproval({
      itemId: "BI-TEST",
      profile: "doc-only",
      artifactRole: "design-spec",
      artifactRef: locator,
      expectedCurrentBaselineId: null,
      supersessionDispositions: [],
      resolvedFindingRefs: [],
      reason: "Independent checklist review passed.",
      reviewerUserId: "user-reviewer",
      reviewerAgentId: "agent-reviewer",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: false, code: "CLASSIFICATION_REQUIRED",
      error: expect.stringContaining("Expected profile: archetype") });
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });
});
