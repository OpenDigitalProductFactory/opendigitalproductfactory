import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  itemFindUnique: vi.fn(),
  authorityFindUnique: vi.fn(),
  principalFindMany: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  prisma: {
    backlogItem: { findUnique: mocks.itemFindUnique },
    authorizationDecisionLog: { findUnique: mocks.authorityFindUnique },
    principalAlias: { findMany: mocks.principalFindMany },
    $transaction: mocks.transaction,
  },
}));

import {
  normalizeInitiativeObjectiveMappings,
  recordInitiativeObjectiveMappingProposal,
} from "./objective-mapping-repository";

const baselineRecordedAt = new Date("2026-09-04T12:00:00.000Z");

function transactionDb(evidence = [{
  id: "E-1",
  backlogItemId: "row-1",
  kind: "evidence",
  recordedAt: new Date("2026-09-04T12:01:00.000Z"),
  payload: { evidenceKind: "test_pass" },
}]) {
  return {
    $queryRaw: vi.fn(async () => []),
    backlogItemActivity: {
      findMany: vi.fn(async (query: { where?: { kind?: string } }) => query.where?.kind === "evidence"
        ? evidence
        : [{
            recordedAt: baselineRecordedAt,
            payload: {
              baselineId: "baseline-1",
              supersedesBaselineId: null,
              artifactDigest: "sha256:design",
              objectiveStatements: [{ objectiveId: "OBJ-TEST-001" }],
              acceptanceStatements: [],
            },
          }]),
      create: mocks.create.mockImplementation(async ({ data }) => data),
    },
  };
}

function proposalArgs() {
  return {
    itemId: "BI-PLATFORM",
    baselineId: "baseline-1",
    mappings: [{ objectiveId: "OBJ-TEST-001", evidenceRefs: ["E-1"] }],
    eligibleEvidenceActivityIds: ["E-1"],
    reason: "Proposed evidence for independent terminal reconciliation.",
    proposerUserId: "user-1",
    proposerAgentId: "agent-1",
    authorityDecisionId: "decision-1",
    tokenScope: "write",
  };
}

describe("normalizeInitiativeObjectiveMappings", () => {
  it("accepts complete objective and acceptance statement mappings", () => {
    expect(normalizeInitiativeObjectiveMappings([
      { objectiveId: "OBJ-1", evidenceRefs: ["E-1"] },
      { objectiveId: "AC-1", evidenceRefs: ["E-2"] },
    ], new Set(["OBJ-1", "AC-1"]))).toEqual([
      { objectiveId: "OBJ-1", evidenceRefs: ["E-1"] },
      { objectiveId: "AC-1", evidenceRefs: ["E-2"] },
    ]);
  });

  it("rejects duplicate, foreign, and empty statement mappings", () => {
    expect(normalizeInitiativeObjectiveMappings([
      { objectiveId: "OBJ-1", evidenceRefs: ["E-1"] },
      { objectiveId: "OBJ-1", evidenceRefs: ["E-2"] },
    ], new Set(["OBJ-1"]))).toBeNull();
    expect(normalizeInitiativeObjectiveMappings([
      { objectiveId: "AC-OTHER", evidenceRefs: ["E-1"] },
    ], new Set(["OBJ-1", "AC-1"]))).toBeNull();
  });
});

describe("recordInitiativeObjectiveMappingProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.itemFindUnique.mockResolvedValue({ id: "row-1", itemId: "BI-PLATFORM", organizationId: null });
    mocks.authorityFindUnique.mockResolvedValue({
      decisionId: "decision-1",
      decision: "allow",
      actionKey: "record_initiative_evidence",
      policyVersion: "authority-v1",
      organizationId: null,
    });
    mocks.principalFindMany.mockResolvedValue([{ principal: { principalId: "principal-1" } }]);
    mocks.transaction.mockImplementation(async (work) => work(transactionDb()));
  });

  it("records platform-scoped authority with the canonical platform sentinel", async () => {
    const result = await recordInitiativeObjectiveMappingProposal(proposalArgs());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.proposal).toMatchObject({ authoritySnapshot: { organizationId: "platform" } });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          authoritySnapshot: expect.objectContaining({ organizationId: "platform" }),
        }),
      }),
    });
  });

  it("rejects the live malformed source-document evidence reference before appending", async () => {
    const args = proposalArgs();
    args.mappings = [{
      objectiveId: "OBJ-TEST-001",
      evidenceRefs: ["docs/superpowers/specs/2026-08-30-some-design.md"],
    }];

    await expect(recordInitiativeObjectiveMappingProposal(args)).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_RECONCILIATION_REQUIRED",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    ["foreign", [{ id: "E-1", backlogItemId: "row-other", kind: "evidence", recordedAt: new Date("2026-09-04T12:01:00.000Z"), payload: { evidenceKind: "test_pass" } }]],
    ["pre-baseline", [{ id: "E-1", backlogItemId: "row-1", kind: "evidence", recordedAt: new Date("2026-09-04T11:59:00.000Z"), payload: { evidenceKind: "test_pass" } }]],
    ["failing", [{ id: "E-1", backlogItemId: "row-1", kind: "evidence", recordedAt: new Date("2026-09-04T12:01:00.000Z"), payload: { evidenceKind: "test_fail" } }]],
  ])("rejects %s activity rows even when their ids appear in the binding", async (_label, evidence) => {
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(evidence)));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_RECONCILIATION_REQUIRED",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects tenant-bound authority for a platform-scoped initiative", async () => {
    mocks.authorityFindUnique.mockResolvedValue({
      decisionId: "decision-1",
      decision: "allow",
      actionKey: "record_initiative_evidence",
      policyVersion: "authority-v1",
      organizationId: "org-other",
    });

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "AUTHORIZATION_DENIED",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
