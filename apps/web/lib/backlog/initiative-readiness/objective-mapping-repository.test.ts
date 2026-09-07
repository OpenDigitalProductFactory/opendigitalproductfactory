import { beforeEach, describe, expect, it, vi } from "vitest";

import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";

const mocks = vi.hoisted(() => ({
  itemFindUnique: vi.fn(),
  authorityFindUnique: vi.fn(),
  principalFindMany: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  loadCapsuleLivenessInventory: vi.fn(),
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

vi.mock("@/lib/work-capsules/liveness-inventory", () => ({
  loadCapsuleLivenessInventory: mocks.loadCapsuleLivenessInventory,
}));

import {
  normalizeInitiativeObjectiveMappings,
  recordInitiativeObjectiveMappingProposal,
} from "./objective-mapping-repository";

const baselineRecordedAt = new Date("2026-09-04T12:00:00.000Z");
const repositoryFullName = "OpenDigitalProductFactory/opendigitalproductfactory";
const headSha = "2".repeat(40);
const artifactCommitSha = "3".repeat(40);
const providerBlobId = "4".repeat(40);

function objectiveMappingBinding(eligibleEvidenceActivityIds = ["E-1"]) {
  return {
    writerToolName: "record_initiative_evidence",
    itemId: "BI-PLATFORM",
    gate: "objective-mapping" as const,
    expectedCurrentBaselineId: "baseline-1",
    eligibleEvidenceActivityIds,
    workroomRef: {
      kind: "workroom-head" as const,
      workroomId: "WC-PLATFORM",
      repositoryFullName,
      branchName: "fix/objective-mapping",
      headSha,
    },
    artifactRef: {
      kind: "repo-blob-at-commit" as const,
      repositoryFullName,
      commitSha: artifactCommitSha,
      path: "docs/superpowers/specs/objective-mapping-design.md",
      providerBlobId,
    },
  };
}

function persistedTaskRun(overrides: Record<string, unknown> = {}) {
  const binding = objectiveMappingBinding();
  const packet = {
    targetAgent: "agent-1",
    objective: "Map every current objective to bounded evidence.",
    questionPacketSummary: "Objective mapping for BI-PLATFORM",
    requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
    binding,
  };
  return {
    taskRunId: "TR-MCP-MAPPING",
    userId: "user-1",
    currentAgentId: "agent-1",
    status: "working",
    completedAt: null,
    archivedAt: null,
    title: packet.questionPacketSummary,
    objective: packet.objective,
    authorityScope: [
      ...packet.requiredToolNames.map((name) => `tool:${name}`),
      "backlog-item:BI-PLATFORM",
    ],
    a2aMetadata: {
      trigger: "external-mcp",
      requestedAgentId: packet.targetAgent,
      requestObjective: packet.objective,
      idempotencyKey: createObjectiveMappingRequestKey(packet),
      initiativeReviewBinding: binding,
    },
    ...overrides,
  };
}

function baselineActivity(options: {
  id?: string;
  baselineId?: string;
  supersedesBaselineId?: string | null;
  recordedAt?: Date;
} = {}) {
  return {
    id: options.id ?? "BASELINE-ACTIVITY-1",
    backlogItemId: "row-1",
    kind: "initiative_scope_baseline",
    recordedAt: options.recordedAt ?? baselineRecordedAt,
    payload: {
      schemaVersion: 1,
      baselineId: options.baselineId ?? "baseline-1",
      supersedesBaselineId: options.supersedesBaselineId ?? null,
      artifactDigest: "sha256:design",
      subject: { kind: "backlog-item", id: "BI-PLATFORM" },
      objectiveStatements: [{ objectiveId: "OBJ-TEST-001" }],
      acceptanceStatements: [],
      artifactRef: objectiveMappingBinding().artifactRef,
    },
  };
}

function validMappingActivity(id = "MAP-VALID", recordedAt = new Date("2026-09-04T12:02:00.000Z")) {
  return {
    id,
    backlogItemId: "row-1",
    kind: "initiative_objective_mapping",
    recordedAt,
    payload: {
      schemaVersion: 1,
      proposalId: id,
      subject: { kind: "backlog-item", id: "BI-PLATFORM" },
      baselineId: "baseline-1",
      artifactDigest: "sha256:design",
      mappings: [{ objectiveId: "OBJ-TEST-001", evidenceRefs: ["E-1"] }],
    },
  };
}

function transactionDb(evidence = [{
  id: "E-1",
  backlogItemId: "row-1",
  kind: "evidence",
  recordedAt: new Date("2026-09-04T12:01:00.000Z"),
  payload: { evidenceKind: "test_pass" },
}], options: {
  taskRun?: ReturnType<typeof persistedTaskRun> | null;
  workroomHeadSha?: string;
  workroom?: Record<string, unknown>;
  baseline?: ReturnType<typeof baselineActivity>;
  baselines?: Array<ReturnType<typeof baselineActivity>>;
  mappings?: Array<ReturnType<typeof validMappingActivity>>;
} = {}) {
  const baselines = options.baselines ?? [options.baseline ?? baselineActivity()];
  return {
    $queryRaw: vi.fn(async () => []),
    taskRun: {
      findUnique: vi.fn().mockResolvedValue(options.taskRun === undefined ? persistedTaskRun() : options.taskRun),
    },
    workroom: {
      findUnique: vi.fn().mockResolvedValue({
        capsuleId: "WC-PLATFORM",
        backlogItemId: "BI-PLATFORM",
        repositoryFullName,
        headBranch: "fix/objective-mapping",
        headSha: options.workroomHeadSha ?? headSha,
        archivedAt: null,
        status: "working",
        ...options.workroom,
      }),
    },
    backlogItemActivity: {
      findMany: vi.fn(async (query: { where?: { kind?: string } }) => query.where?.kind === "evidence"
        ? evidence
        : query.where?.kind === "initiative_objective_mapping"
          ? options.mappings ?? []
          : baselines),
      create: mocks.create.mockImplementation(async ({ data }) => data),
    },
  };
}

function proposalArgs() {
  return {
    taskRunId: "TR-MCP-MAPPING",
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
    mocks.loadCapsuleLivenessInventory.mockResolvedValue({
      capsulesAll: [{ capsuleId: "WC-PLATFORM", isLive: true }],
      livenessSummary: {},
    });
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

  it("rejects a direct call without a bound executing TaskRun", async () => {
    await expect(recordInitiativeObjectiveMappingProposal({
      ...proposalArgs(),
      taskRunId: null,
    })).resolves.toMatchObject({
      ok: false,
      code: "AUTHORIZATION_DENIED",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an executing TaskRun whose objective-mapping key is not server-derived", async () => {
    const taskRun = persistedTaskRun();
    taskRun.a2aMetadata.idempotencyKey = `${taskRun.a2aMetadata.idempotencyKey}-caller-suffix`;
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(undefined, { taskRun })));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a stale executing TaskRun after the live Workroom head advances", async () => {
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(undefined, {
      workroomHeadSha: "5".repeat(40),
    })));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ["terminal", { status: "completed", completedAt: new Date("2026-09-04T12:03:00.000Z") }],
    ["archived", { archivedAt: new Date("2026-09-04T12:03:00.000Z") }],
    ["different delegating user", { userId: "user-other" }],
    ["different acting agent", { currentAgentId: "agent-other" }],
    ["missing backlog authority", {
      authorityScope: ["tool:read_source_at_version", "tool:record_initiative_evidence"],
    }],
  ])("rejects a %s TaskRun authority packet", async (_label, overrides) => {
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(undefined, {
      taskRun: persistedTaskRun(overrides),
    })));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a caller agent that differs from the TaskRun's bound reviewer", async () => {
    await expect(recordInitiativeObjectiveMappingProposal({
      ...proposalArgs(),
      proposerAgentId: "agent-other",
    })).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an identity-matching Workroom that is not canonically live", async () => {
    mocks.loadCapsuleLivenessInventory.mockResolvedValue({
      capsulesAll: [{ capsuleId: "WC-PLATFORM", isLive: false }],
      livenessSummary: {},
    });

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT",
    });
    expect(mocks.loadCapsuleLivenessInventory).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects when the current baseline artifact differs from the TaskRun binding", async () => {
    const baseline = baselineActivity();
    baseline.payload.artifactRef.providerBlobId = "6".repeat(40);
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(undefined, { baseline })));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_BASELINE_CONFLICT",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a baseline whose canonical subject differs from the mapped backlog item", async () => {
    const baseline = baselineActivity();
    baseline.payload.subject.id = "BI-OTHER";
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(undefined, { baseline })));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_BASELINE_CONFLICT",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects when the TaskRun baseline is no longer the current chain head", async () => {
    const original = baselineActivity();
    const successor = baselineActivity({
      id: "BASELINE-ACTIVITY-2",
      recordedAt: new Date("2026-09-04T12:00:30.000Z"),
      baselineId: "baseline-2",
      supersedesBaselineId: "baseline-1",
    });
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(undefined, {
      baselines: [original, successor],
    })));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_BASELINE_CONFLICT",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects when the current eligible evidence set differs from the immutable TaskRun binding", async () => {
    const evidence = [
      {
        id: "E-1",
        backlogItemId: "row-1",
        kind: "evidence",
        recordedAt: new Date("2026-09-04T12:01:00.000Z"),
        payload: { evidenceKind: "test_pass" },
      },
      {
        id: "E-2",
        backlogItemId: "row-1",
        kind: "evidence",
        recordedAt: new Date("2026-09-04T12:01:01.000Z"),
        payload: { evidenceKind: "test_pass" },
      },
    ];
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(evidence)));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_RECONCILIATION_REQUIRED",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a second append when the newest current mapping is canonically valid", async () => {
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(undefined, {
      mappings: [validMappingActivity()],
    })));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_MAPPING_ALREADY_EXISTS",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("allows one correction when a malformed mapping is newer than an older valid mapping", async () => {
    const malformed = validMappingActivity("MAP-MALFORMED", new Date("2026-09-04T12:03:00.000Z"));
    malformed.payload.mappings = [];
    mocks.transaction.mockImplementation(async (work) => work(transactionDb(undefined, {
      mappings: [malformed, validMappingActivity("MAP-OLDER")],
    })));

    await expect(recordInitiativeObjectiveMappingProposal(proposalArgs())).resolves.toMatchObject({ ok: true });
    expect(mocks.create).toHaveBeenCalledTimes(1);
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
