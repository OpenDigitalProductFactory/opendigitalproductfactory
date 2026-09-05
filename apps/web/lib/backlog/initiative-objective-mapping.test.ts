import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  prisma: {
    backlogItem: { findUnique: vi.fn(async () => ({ id: "row-1", itemId: "BI-TEST", organizationId: "org-1" })) },
    authorizationDecisionLog: { findUnique: vi.fn(async () => ({
      decisionId: "decision-1",
      decision: "allow",
      actionKey: "record_initiative_evidence",
      policyVersion: "authority-v1",
      organizationId: "org-1",
    })) },
    principalAlias: { findMany: vi.fn(async () => [{ principal: { principalId: "principal-1" } }]) },
    $transaction: mocks.transaction,
  },
}));

import { recordInitiativeObjectiveMappingProposal } from "./initiative-readiness";

function transactionDb() {
  const baselineRecordedAt = new Date("2026-09-04T12:00:00.000Z");
  return {
    $queryRaw: vi.fn(async () => []),
    backlogItemActivity: {
      findMany: vi.fn(async (query: { where?: { kind?: string } }) => query.where?.kind === "evidence"
        ? [{
            id: "E-1",
            backlogItemId: "row-1",
            kind: "evidence",
            recordedAt: new Date("2026-09-04T12:01:00.000Z"),
            payload: { evidenceKind: "test_pass" },
          }]
        : [{
            recordedAt: baselineRecordedAt,
            payload: {
              baselineId: "baseline-1",
              supersedesBaselineId: null,
              artifactDigest: "sha256:design",
              objectiveStatements: [{ objectiveId: "OBJ-TEST-001" }],
              acceptanceStatements: [{ acceptanceId: "ACCEPT-TEST-001" }],
            },
          }]),
      create: mocks.create.mockImplementation(async ({ data }) => data),
    },
  };
}

describe("recordInitiativeObjectiveMappingProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (work) => work(transactionDb()));
  });

  it("stores a current-baseline proposal without any pass or completion verdict", async () => {
    const result = await recordInitiativeObjectiveMappingProposal({
      itemId: "BI-TEST",
      baselineId: "baseline-1",
      mappings: [
        { objectiveId: "OBJ-TEST-001", evidenceRefs: ["E-1"] },
        { objectiveId: "ACCEPT-TEST-001", evidenceRefs: ["E-1"] },
      ],
      eligibleEvidenceActivityIds: ["E-1"],
      reason: "Proposed evidence for independent terminal reconciliation.",
      proposerUserId: "user-1",
      proposerAgentId: "agent-1",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.transaction.mock.calls[0]![1]).toEqual({ isolationLevel: "Serializable" });
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "initiative_objective_mapping" }) });
    const payload = mocks.create.mock.calls[0]![0].data.payload;
    expect(payload).not.toHaveProperty("decision");
    expect(payload).not.toHaveProperty("verdict");
  });

  it("rejects a proposal for an objective outside the current baseline", async () => {
    await expect(recordInitiativeObjectiveMappingProposal({
      itemId: "BI-TEST",
      baselineId: "baseline-1",
      mappings: [{ objectiveId: "OBJ-NOT-CURRENT", evidenceRefs: ["verification:unit-1"] }],
      eligibleEvidenceActivityIds: ["verification:unit-1"],
      reason: "Attempted stale objective mapping.",
      proposerUserId: "user-1",
      proposerAgentId: "agent-1",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
