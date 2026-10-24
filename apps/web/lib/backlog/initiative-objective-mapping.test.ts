import { beforeEach, describe, expect, it, vi } from "vitest";

import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  transaction: vi.fn(),
  loadCapsuleLivenessInventory: vi.fn(),
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

vi.mock("@/lib/work-capsules/liveness-inventory", () => ({
  loadCapsuleLivenessInventory: mocks.loadCapsuleLivenessInventory,
}));

import { recordInitiativeObjectiveMappingProposal } from "./initiative-readiness";

const repositoryFullName = "OpenDigitalProductFactory/opendigitalproductfactory";
const artifactRef = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName,
  commitSha: "3".repeat(40),
  path: "docs/superpowers/specs/objective-mapping-design.md",
  providerBlobId: "4".repeat(40),
};
const binding = {
  writerToolName: "record_initiative_evidence",
  itemId: "BI-TEST",
  gate: "objective-mapping" as const,
  expectedCurrentBaselineId: "baseline-1",
  eligibleEvidenceActivityIds: ["E-1"],
  workroomRef: {
    kind: "workroom-head" as const,
    workroomId: "WC-TEST",
    repositoryFullName,
    branchName: "fix/objective-mapping",
    headSha: "2".repeat(40),
  },
  artifactRef,
};
const requestPacket = {
  targetAgent: "agent-1",
  objective: "Map every current objective to bounded evidence.",
  questionPacketSummary: "Objective mapping for BI-TEST",
  requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
  binding,
};

function transactionDb() {
  const baselineRecordedAt = new Date("2026-09-04T12:00:00.000Z");
  return {
    $queryRaw: vi.fn(async () => []),
    taskRun: {
      findUnique: vi.fn(async () => ({
        taskRunId: "TR-MCP-MAPPING",
        userId: "user-1",
        currentAgentId: "agent-1",
        status: "working",
        completedAt: null,
        archivedAt: null,
        title: requestPacket.questionPacketSummary,
        objective: requestPacket.objective,
        authorityScope: [
          ...requestPacket.requiredToolNames.map((name) => `tool:${name}`),
          "backlog-item:BI-TEST",
        ],
        a2aMetadata: {
          trigger: "external-mcp",
          requestedAgentId: requestPacket.targetAgent,
          requestObjective: requestPacket.objective,
          idempotencyKey: createObjectiveMappingRequestKey(requestPacket),
          initiativeReviewBinding: binding,
        },
      })),
    },
    workroom: {
      findUnique: vi.fn(async () => ({
        capsuleId: "WC-TEST",
        backlogItemId: "BI-TEST",
        repositoryFullName,
        headBranch: "fix/objective-mapping",
        headSha: "2".repeat(40),
        archivedAt: null,
      })),
    },
    backlogItemActivity: {
      findMany: vi.fn(async (query: { where?: { kind?: string } }) => query.where?.kind === "evidence"
        ? [{
            id: "E-1",
            backlogItemId: "row-1",
            kind: "evidence",
            recordedAt: new Date("2026-09-04T12:01:00.000Z"),
            payload: { evidenceKind: "test_pass" },
          }]
        : query.where?.kind === "initiative_objective_mapping"
          ? []
          : [{
            id: "BASELINE-ACTIVITY-1",
            backlogItemId: "row-1",
            kind: "initiative_scope_baseline",
            recordedAt: baselineRecordedAt,
            payload: {
              schemaVersion: 1,
              baselineId: "baseline-1",
              supersedesBaselineId: null,
              artifactDigest: "sha256:design",
              subject: { kind: "backlog-item", id: "BI-TEST" },
              objectiveStatements: [{ objectiveId: "OBJ-TEST-001" }],
              acceptanceStatements: [{ acceptanceId: "ACCEPT-TEST-001" }],
              artifactRef,
            },
          }]),
      create: mocks.create.mockImplementation(async ({ data }) => data),
    },
  };
}

describe("recordInitiativeObjectiveMappingProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadCapsuleLivenessInventory.mockResolvedValue({
      capsulesAll: [{ capsuleId: "WC-TEST", isLive: true }],
      livenessSummary: {},
    });
    mocks.transaction.mockImplementation(async (work) => work(transactionDb()));
  });

  it("stores a current-baseline proposal without any pass or completion verdict", async () => {
    const result = await recordInitiativeObjectiveMappingProposal({
      taskRunId: "TR-MCP-MAPPING",
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
      taskRunId: "TR-MCP-MAPPING",
      itemId: "BI-TEST",
      baselineId: "baseline-1",
      mappings: [{ objectiveId: "OBJ-NOT-CURRENT", evidenceRefs: ["E-1"] }],
      eligibleEvidenceActivityIds: ["E-1"],
      reason: "Attempted stale objective mapping.",
      proposerUserId: "user-1",
      proposerAgentId: "agent-1",
      authorityDecisionId: "decision-1",
      tokenScope: "write",
    })).resolves.toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
