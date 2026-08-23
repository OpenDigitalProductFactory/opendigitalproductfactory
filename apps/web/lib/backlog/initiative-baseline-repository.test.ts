import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveArtifact: vi.fn(),
  writeBlob: vi.fn(),
  transaction: vi.fn(),
  activityCreate: vi.fn(),
  pinCreate: vi.fn(),
  backlogItemFind: vi.fn(),
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
      findUnique: vi.fn(async () => ({
        decisionId: "decision-1",
        decision: "allow",
        actionKey: "record_initiative_design_review",
        policyVersion: "authority-v1",
        organizationId: "org-1",
      })),
    },
    principalAlias: {
      findMany: vi.fn(async () => [{ principal: { principalId: "principal-reviewer" } }]),
    },
    $transaction: mocks.transaction,
  },
}));

import { recordInitiativeSpecApproval } from "./initiative-readiness/baseline-repository";

const canonical = `**OBJ-TEST-001:** Preserve the approved objective.
| AC-TEST-001 | OBJ-TEST-001 | Completion proves the objective. | test |
`;
const locator = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: "a".repeat(40),
  path: "docs/superpowers/specs/test.md",
  providerBlobId: "b".repeat(40),
};

function tx() {
  return {
    $queryRaw: vi.fn(async () => []),
    backlogItem: {
      findUnique: vi.fn(async () => ({
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
    backlogItemActivity: {
      findMany: vi.fn(async () => []),
      create: mocks.activityCreate.mockImplementation(async ({ data }) => data),
    },
    documentBlob: { upsert: vi.fn(async () => ({ id: "blob-1", storageKey: "documents/sha256/provider", sizeBytes: canonical.length })) },
    document: {
      create: vi.fn(async () => ({ id: "doc-row" })),
      update: vi.fn(async () => ({ id: "doc-row" })),
    },
    documentVersion: { create: vi.fn(async () => ({ id: "version-1" })) },
    initiativeArtifactRetentionPin: {
      create: mocks.pinCreate.mockImplementation(async ({ data }) => data),
    },
  };
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

  it("fails closed when the canonical governed item has no organization", async () => {
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
    })).resolves.toMatchObject({ ok: false, code: "CLASSIFICATION_REQUIRED" });
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });
});
