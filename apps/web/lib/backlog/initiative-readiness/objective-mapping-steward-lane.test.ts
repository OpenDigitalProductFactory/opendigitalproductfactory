// BI-099A0BA3: a routed acceptance steward room's drive-dispatched run writes
// the objective mapping under a packet the platform issued to the room. The
// external-MCP lane is unchanged and the repository still refuses any packet
// the server did not issue.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "@/lib/work-management/workroom-shape-claim";

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

import { recordInitiativeObjectiveMappingProposal } from "./objective-mapping-repository";

const NOW = new Date("2026-10-07T05:00:00.000Z");
const ITEM = "BI-AAAA0001";
const STEWARD_CAPSULE = "WC-ACC-AAAA0001";
const DRIVE_TASK = `workroom-${STEWARD_CAPSULE}-acceptance-verification`;
const VERIFIER = "AGT-WS-VERIFY";
const OPERATOR = "user-operator";
const repositoryFullName = "OpenDigitalProductFactory/opendigitalproductfactory";
const headSha = "2".repeat(40);
const baselineRecordedAt = new Date("2026-09-04T12:00:00.000Z");

function binding() {
  return {
    writerToolName: "record_initiative_evidence",
    itemId: ITEM,
    gate: "objective-mapping" as const,
    expectedCurrentBaselineId: "baseline-1",
    eligibleEvidenceActivityIds: ["E-1"],
    workroomRef: {
      kind: "workroom-head" as const,
      workroomId: "WC-DELIVERY",
      repositoryFullName,
      branchName: "fix/delivery",
      headSha,
    },
    artifactRef: {
      kind: "repo-blob-at-commit" as const,
      repositoryFullName,
      commitSha: "3".repeat(40),
      path: "docs/superpowers/specs/delivery-design.md",
      providerBlobId: "4".repeat(40),
    },
  };
}

function issuedPacket(over: { targetAgent?: string; requestKey?: string } = {}) {
  const packet = {
    targetAgent: over.targetAgent ?? VERIFIER,
    objective: "Map every current objective to bounded evidence.",
    questionPacketSummary: `Objective mapping for ${ITEM}`,
    requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
    binding: binding(),
  };
  return {
    targetAgent: packet.targetAgent,
    objective: packet.objective,
    questionPacketSummary: packet.questionPacketSummary,
    requestKey: over.requestKey ?? createObjectiveMappingRequestKey(packet),
    tier: 2,
    enteredVia: "handoff",
    requiredToolNames: packet.requiredToolNames,
    initiativeReviewBinding: packet.binding,
  };
}

function scheduledRun(over: Record<string, unknown> = {}) {
  return {
    taskRunId: "TR-SCHED-ABCD1234",
    userId: OPERATOR,
    currentAgentId: VERIFIER,
    status: "working",
    completedAt: null,
    archivedAt: null,
    title: `Workroom ${STEWARD_CAPSULE} / verify`,
    objective: "stage brief",
    authorityScope: [],
    a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: DRIVE_TASK } },
    ...over,
  };
}

function stewardRoom(over: Record<string, unknown> = {}) {
  return {
    id: "room-steward",
    capsuleId: STEWARD_CAPSULE,
    idempotencyKey: `acceptance:${ITEM}`,
    status: "working",
    archivedAt: null,
    outcomeAnchor: { kind: "backlog-item", id: ITEM },
    scopeClaims: [
      buildWorkShapeClaim("acceptance-verification@1.0.0", NOW),
      buildWorkShapeRoleBindingsClaim({ "acceptance-verifier": `agent:${VERIFIER}` }, NOW),
    ],
    ...over,
  };
}

function deliveryRoom() {
  return {
    capsuleId: "WC-DELIVERY",
    backlogItemId: ITEM,
    repositoryFullName,
    headBranch: "fix/delivery",
    headSha,
    archivedAt: null,
  };
}

function packetActivity(over: Record<string, unknown> = {}) {
  return {
    payload: { schemaVersion: 1, itemId: ITEM, requestCoworker: issuedPacket() },
    recordedByAgentId: "AGT-WS-PORTFOLIO",
    recordedById: null,
    ...over,
  };
}

function txDb(options: {
  run?: Record<string, unknown> | null;
  steward?: Record<string, unknown> | null;
  activity?: Record<string, unknown> | null;
} = {}) {
  const run = options.run === undefined ? scheduledRun() : options.run;
  const steward = options.steward === undefined ? stewardRoom() : options.steward;
  return {
    $queryRaw: vi.fn(async () => []),
    taskRun: { findUnique: vi.fn().mockResolvedValue(run) },
    workroom: {
      findUnique: vi.fn(async ({ where }: { where: { capsuleId: string } }) =>
        where.capsuleId === STEWARD_CAPSULE ? steward : where.capsuleId === "WC-DELIVERY" ? deliveryRoom() : null),
    },
    workroomActivity: {
      findFirst: vi.fn().mockResolvedValue(options.activity === undefined ? packetActivity() : options.activity),
    },
    backlogItemActivity: {
      findMany: vi.fn(async (query: { where?: { kind?: string } }) => query.where?.kind === "evidence"
        ? [{ id: "E-1", backlogItemId: "row-1", kind: "evidence", recordedAt: new Date("2026-09-04T12:01:00.000Z"), payload: { evidenceKind: "test_pass" } }]
        : query.where?.kind === "initiative_objective_mapping"
          ? []
          : [{
            id: "BASELINE-1",
            backlogItemId: "row-1",
            kind: "initiative_scope_baseline",
            recordedAt: baselineRecordedAt,
            payload: {
              schemaVersion: 1,
              baselineId: "baseline-1",
              supersedesBaselineId: null,
              artifactDigest: "sha256:design",
              subject: { kind: "backlog-item", id: ITEM },
              objectiveStatements: [{ objectiveId: "OBJ-1" }],
              acceptanceStatements: [],
              artifactRef: binding().artifactRef,
            },
          }]),
      create: mocks.create.mockImplementation(async ({ data }) => data),
    },
  };
}

function stewardArgs(over: Record<string, unknown> = {}) {
  return {
    taskRunId: "TR-SCHED-ABCD1234",
    itemId: ITEM,
    baselineId: "baseline-1",
    mappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-1"] }],
    eligibleEvidenceActivityIds: ["E-1"],
    reason: "Verified on the live install: the sweep closes the routed item.",
    proposerUserId: OPERATOR,
    proposerAgentId: VERIFIER,
    authorityDecisionId: "decision-1",
    // A scheduled in-platform run carries no client token.
    tokenScope: null,
    ...over,
  };
}

describe("objective mapping from an acceptance steward room's scheduled run (BI-099A0BA3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.itemFindUnique.mockResolvedValue({ id: "row-1", itemId: ITEM, organizationId: null });
    mocks.authorityFindUnique.mockResolvedValue({
      decisionId: "decision-1", decision: "allow", actionKey: "record_initiative_evidence", policyVersion: "authority-v1", organizationId: null,
    });
    mocks.principalFindMany.mockResolvedValue([{ principal: { principalId: "principal-operator" } }]);
    mocks.loadCapsuleLivenessInventory.mockResolvedValue({ capsulesAll: [{ capsuleId: "WC-DELIVERY", isLive: true }], livenessSummary: {} });
    mocks.transaction.mockImplementation(async (work) => work(txDb()));
  });

  it("records the mapping written by the room-bound in-platform coworker under the platform-issued packet", async () => {
    const result = await recordInitiativeObjectiveMappingProposal(stewardArgs());

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.proposal).toMatchObject({
      subject: { kind: "backlog-item", id: ITEM },
      baselineId: "baseline-1",
      proposerAgentId: VERIFIER,
      eligibleEvidenceActivityIds: ["E-1"],
      authoritySnapshot: { tokenScope: "organization", actionKey: "record_initiative_evidence", decision: "allow" },
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a request key the server did not derive", { activity: packetActivity({ payload: { requestCoworker: issuedPacket({ requestKey: `${issuedPacket().requestKey}-forged` }) } }) }],
    ["a packet re-targeted at the run's agent without a new server key", {
      activity: packetActivity({ payload: { requestCoworker: { ...issuedPacket({ targetAgent: "AGT-OTHER" }), targetAgent: VERIFIER } } }),
    }],
    ["a valid packet issued to another coworker", { activity: packetActivity({ payload: { requestCoworker: issuedPacket({ targetAgent: "AGT-OTHER" }) } }) }],
    ["a packet activity recorded by a coworker rather than the sweep", { activity: packetActivity({ recordedByAgentId: VERIFIER }) }],
    ["a packet activity recorded by a person", { activity: packetActivity({ recordedById: "user-x" }) }],
    ["no packet issued to the room", { activity: null }],
    ["a scheduled run that is not the steward room's drive task", { run: scheduledRun({ a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: "some-other-task" } } }) }],
    ["a finished scheduled run", { run: scheduledRun({ status: "completed", completedAt: NOW }) }],
    ["a steward room bound to another coworker", {
      steward: stewardRoom({ scopeClaims: [buildWorkShapeClaim("acceptance-verification@1.0.0", NOW), buildWorkShapeRoleBindingsClaim({ "acceptance-verifier": "agent:AGT-OTHER" }, NOW)] }),
    }],
    ["an archived steward room", { steward: stewardRoom({ archivedAt: NOW }) }],
    ["a steward room anchored to another item", { steward: stewardRoom({ outcomeAnchor: { kind: "backlog-item", id: "BI-OTHER" } }) }],
  ])("refuses %s", async (_label, options) => {
    mocks.transaction.mockImplementation(async (work) => work(txDb(options)));

    await expect(recordInitiativeObjectiveMappingProposal(stewardArgs())).resolves.toMatchObject({
      ok: false,
      code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses a writer other than the run's agent, or another delegating user", async () => {
    await expect(recordInitiativeObjectiveMappingProposal(stewardArgs({ proposerAgentId: "AGT-OTHER" })))
      .resolves.toMatchObject({ ok: false, code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT" });
    await expect(recordInitiativeObjectiveMappingProposal(stewardArgs({ proposerUserId: "user-other" })))
      .resolves.toMatchObject({ ok: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("still applies the external checks to the issued packet: a stale evidence set is refused", async () => {
    await expect(recordInitiativeObjectiveMappingProposal(stewardArgs({ eligibleEvidenceActivityIds: ["E-1", "E-2"] })))
      .resolves.toMatchObject({ ok: false, code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("an external-MCP run without a token scope is still refused before any read", async () => {
    await expect(recordInitiativeObjectiveMappingProposal(stewardArgs({ taskRunId: "TR-MCP-MAPPING" })))
      .resolves.toMatchObject({ ok: false, code: "AUTHORIZATION_DENIED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
