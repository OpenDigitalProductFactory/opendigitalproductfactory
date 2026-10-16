import { describe, expect, it, vi } from "vitest";

import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { bodyCriteriaVersion } from "./body-baseline-version";

import {
  ObjectiveMappingAdmissionRefusal,
  prepareObjectiveMappingSubmissionAdmission,
} from "./objective-mapping-submission-admission";

const repositoryFullName = "OpenDigitalProductFactory/opendigitalproductfactory";
const headSha = "2".repeat(40);
const artifactCommitSha = "3".repeat(40);
const providerBlobId = "4".repeat(40);
const recordedAt = new Date("2026-09-06T08:00:00.000Z");

function packet(evidenceIds = ["E-1", "E-2"]) {
  const base = {
    targetAgent: "AGT-WS-PORTFOLIO",
    objective: "Map every current objective to the exact bounded evidence.",
    questionPacketSummary: "objective-mapping for BI-ATOMIC at 222222222222",
    requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
    binding: {
      writerToolName: "record_initiative_evidence",
      itemId: "BI-ATOMIC",
      gate: "objective-mapping" as const,
      expectedCurrentBaselineId: "baseline-current",
      eligibleEvidenceActivityIds: evidenceIds,
      workroomRef: {
        kind: "workroom-head" as const,
        workroomId: "WC-ATOMIC",
        repositoryFullName,
        branchName: "fix/atomic-mapping",
        headSha,
      },
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName,
        commitSha: artifactCommitSha,
        path: "docs/superpowers/specs/atomic-design.md",
        providerBlobId,
      },
    },
  };
  return { ...base, requestKey: createObjectiveMappingRequestKey(base) };
}

function persistedHistoryRow(input: {
  taskRunId: string;
  request: ReturnType<typeof packet>;
  status: string;
  requestObjective?: unknown;
}) {
  return {
    taskRunId: input.taskRunId,
    status: input.status,
    title: input.request.questionPacketSummary,
    objective: input.request.objective,
    authorityScope: input.request.requiredToolNames.map((name) => `tool:${name}`),
    a2aMetadata: {
      idempotencyKey: input.request.requestKey,
      requestedAgentId: input.request.targetAgent,
      initiativeReviewBinding: input.request.binding,
      ...(Object.prototype.hasOwnProperty.call(input, "requestObjective")
        ? { requestObjective: input.requestObjective } : {}),
    },
    actionEnvelopes: [],
  };
}

function admissionDb() {
  let historyRows: ReturnType<typeof persistedHistoryRow>[] = [];
  const backlogItemActivity = {
    findMany: vi.fn(async (args: { where: { kind: string } }) => {
      if (args.where.kind === "initiative_scope_baseline") {
        return [{
          id: "BASELINE-CURRENT",
          backlogItemId: "row-bi-atomic",
          kind: "initiative_scope_baseline",
          recordedAt,
          payload: {
            schemaVersion: 1,
            baselineId: "baseline-current",
            supersedesBaselineId: null,
            artifactDigest: "digest-current",
            subject: { kind: "backlog-item", id: "BI-ATOMIC" },
            objectiveStatements: [{ objectiveId: "OBJ-ATOMIC" }],
            acceptanceStatements: [{ acceptanceId: "AC-ATOMIC" }],
            artifactRef: {
              kind: "repo-blob-at-commit",
              repositoryFullName,
              commitSha: artifactCommitSha,
              path: "docs/superpowers/specs/atomic-design.md",
              providerBlobId,
            },
          },
        }];
      }
      if (args.where.kind === "evidence") {
        return ["E-1", "E-2"].map((id) => ({
          id,
          backlogItemId: "row-bi-atomic",
          kind: "evidence",
          recordedAt: new Date(recordedAt.getTime() + 1_000),
          payload: { evidenceKind: "test_pass" },
        }));
      }
      return [];
    }),
  };
  const db = {
    backlogItem: {
      findUnique: vi.fn().mockResolvedValue({ id: "row-bi-atomic", itemId: "BI-ATOMIC" }),
    },
    workroom: {
      findUnique: vi.fn().mockResolvedValue({
        capsuleId: "WC-ATOMIC",
        backlogItemId: "BI-ATOMIC",
        repositoryFullName,
        baseSha: "1".repeat(40),
        headBranch: "fix/atomic-mapping",
        headSha,
        archivedAt: null,
      }),
    },
    backlogItemActivity,
    taskRun: {
      findMany: vi.fn(async () => historyRows),
    },
    toolExecution: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return {
    db,
    tx: { ...db, $queryRaw: vi.fn().mockResolvedValue([]) },
    setHistory(rows: ReturnType<typeof persistedHistoryRow>[]) {
      historyRows = rows;
    },
  };
}

describe("objective-mapping action-time admission", () => {
  it("admits an archived exact merged body author and rechecks source under the transaction lock", async () => {
    const fixture = admissionDb();
    const body = "## Acceptance\n- Verify delivered repair.";
    const original = packet();
    const current = { ...original, binding: { ...original.binding, artifactRef: {
      kind: "document-version" as const, repositoryFullName, versionId: "body-v1", valueDigest: "sha256:body" } } };
    current.requestKey = createObjectiveMappingRequestKey(current);
    const room = { capsuleId: "WC-ATOMIC", id: "room-row", backlogItemId: "BI-ATOMIC", repositoryFullName,
      headBranch: current.binding.workroomRef.branchName, headSha, baseSha: "1".repeat(40),
      createdByPrincipalId: "author", status: "archived", pullRequestNumber: 6265,
      archivedAt: new Date("2026-10-16T06:00:00Z"), createdAt: new Date("2026-10-15T06:00:00Z") };
    fixture.db.workroom.findUnique.mockResolvedValue(room);
    fixture.db.backlogItem.findUnique.mockResolvedValue({ id: "row-bi-atomic", itemId: "BI-ATOMIC", body, organizationId: null } as never);
    const readActivities = fixture.db.backlogItemActivity.findMany.getMockImplementation()!;
    fixture.db.backlogItemActivity.findMany.mockImplementation(async query => {
      const rows = await readActivities(query);
      if (query.where.kind !== "initiative_scope_baseline") return rows;
      return rows.map(row => ({ ...row, payload: { ...row.payload, origin: "item-body",
        artifactRef: current.binding.artifactRef, criteriaDigest: bodyCriteriaVersion(body)!.criteriaDigest,
        sourceIdentity: { repositoryFullName, headSha }, authoritySnapshot: { organizationId: "platform" } } })) as never;
    });
    const db = { ...fixture.db, workroom: { ...fixture.db.workroom,
      findMany: vi.fn(async ({ where }) => where.archivedAt === null ? [] : [room]) },
      contributorInventorySnapshot: { findMany: vi.fn().mockResolvedValue([{ payload: createPullRequestObservation({
        repositoryFullName, number: 6265, url: `https://github.com/${repositoryFullName}/pull/6265`, title: "repair",
        headBranch: room.headBranch, headSha, state: "merged", isDraft: false, mergeStateStatus: null,
        mergeCommitSha: "c".repeat(40), mergedAt: "2026-10-16T05:00:00Z", providerUpdatedAt: "2026-10-16T05:00:00Z",
        observedAt: "2026-10-16T05:01:00Z" }) }]) } };
    const result = await prepareObjectiveMappingSubmissionAdmission({ packet: current, expectedTaskRunId: "TR-NEW",
      ports: { db: db as never, verifyHistoricalArtifact: vi.fn(), workroomIsLive: vi.fn().mockResolvedValue(false) } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(result.data.admissionGuard({ ...db, $queryRaw: vi.fn() } as never)).resolves.toBeUndefined();
    db.contributorInventorySnapshot.findMany.mockResolvedValue([]);
    await expect(result.data.admissionGuard({ ...db, $queryRaw: vi.fn() } as never)).rejects.toMatchObject({ reason: "workroom-identity-conflict" });
  });
  it("replays the accepted same task after a missing writer using the full immutable objective", async () => {
    const fixture = admissionDb();
    const current = packet();
    current.objective = current.objective.padEnd(1236, "x");
    current.requestKey = createObjectiveMappingRequestKey(current);
    const ports = {
      db: fixture.db as never,
      verifyHistoricalArtifact: vi.fn(),
      workroomIsLive: vi.fn().mockResolvedValue(true),
    };
    const accepted = await prepareObjectiveMappingSubmissionAdmission({
      packet: current, expectedTaskRunId: "TR-MCP-SUCCESSOR", ports,
    });
    expect(accepted.ok).toBe(true);
    const row = persistedHistoryRow({
      taskRunId: "TR-MCP-SUCCESSOR", request: current,
      status: "input-required", requestObjective: current.objective,
    });
    row.objective = current.objective.slice(0, 1000);
    fixture.setHistory([row]);
    const replay = await prepareObjectiveMappingSubmissionAdmission({
      packet: current, expectedTaskRunId: "TR-MCP-SUCCESSOR", ports,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    await expect(replay.data.admissionGuard(fixture.tx as never)).resolves.toBeUndefined();
    expect(row.objective).toHaveLength(1000);
    expect(row.a2aMetadata.requestObjective).toHaveLength(1236);
    expect(fixture.db.toolExecution.findMany).toHaveBeenCalled();
  });

  it.each([null, "", "   ", 1236, {}, [], undefined].map((requestObjective) => ({ requestObjective })))("rejects present invalid immutable objective $requestObjective instead of falling back", async ({ requestObjective }) => {
    const fixture = admissionDb();
    const current = packet();
    fixture.setHistory([persistedHistoryRow({
      taskRunId: "TR-MCP-SUCCESSOR", request: current,
      status: "input-required", requestObjective,
    })]);
    const replay = await prepareObjectiveMappingSubmissionAdmission({
      packet: current, expectedTaskRunId: "TR-MCP-SUCCESSOR",
      ports: { db: fixture.db as never, verifyHistoricalArtifact: vi.fn(), workroomIsLive: vi.fn().mockResolvedValue(true) },
    });
    expect(replay).toMatchObject({ ok: false, refusal: { reason: "objective-mapping-history-unavailable" } });
  });

  it.each(["legacy-exact", "legacy-truncated", "metadata-conflict"])("keeps the immutable key check for %s history", async (scenario) => {
    const fixture = admissionDb();
    const current = packet();
    const row = persistedHistoryRow({
      taskRunId: "TR-MCP-SUCCESSOR", request: current, status: "input-required",
      ...(scenario === "metadata-conflict" ? { requestObjective: "A different requested outcome" } : {}),
    });
    if (scenario === "legacy-truncated") row.objective = row.objective.slice(0, 10);
    fixture.setHistory([row]);
    const replay = await prepareObjectiveMappingSubmissionAdmission({
      packet: current, expectedTaskRunId: "TR-MCP-SUCCESSOR",
      ports: { db: fixture.db as never, verifyHistoricalArtifact: vi.fn(), workroomIsLive: vi.fn().mockResolvedValue(true) },
    });
    if (scenario === "legacy-exact") expect(replay.ok).toBe(true);
    else expect(replay).toMatchObject({ ok: false, refusal: { reason: "immutable-identity-conflict" } });
  });

  it("re-reads under the item lock and refuses an alternate key that appeared after preparation", async () => {
    const fixture = admissionDb();
    const current = packet();
    const prepared = await prepareObjectiveMappingSubmissionAdmission({
      packet: current,
      expectedTaskRunId: "TR-MCP-CURRENT",
      ports: {
        db: fixture.db as never,
        verifyHistoricalArtifact: vi.fn(),
        workroomIsLive: vi.fn().mockResolvedValue(true),
      },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const alternate = packet(["E-1"]);
    fixture.setHistory([persistedHistoryRow({
      taskRunId: "TR-MCP-ALTERNATE",
      request: alternate,
      status: "working",
    })]);

    await expect(prepared.data.admissionGuard(fixture.tx as never)).rejects.toMatchObject({
      name: "ObjectiveMappingAdmissionRefusal",
      reason: "immutable-identity-conflict",
      taskRunId: "TR-MCP-ALTERNATE",
    } satisfies Partial<ObjectiveMappingAdmissionRefusal>);
    expect(fixture.tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("refuses the same request key when it belongs to a different token-bound TaskRun", async () => {
    const fixture = admissionDb();
    const current = packet();
    const prepared = await prepareObjectiveMappingSubmissionAdmission({
      packet: current,
      expectedTaskRunId: "TR-MCP-EXPECTED",
      ports: {
        db: fixture.db as never,
        verifyHistoricalArtifact: vi.fn(),
        workroomIsLive: vi.fn().mockResolvedValue(true),
      },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    fixture.setHistory([persistedHistoryRow({
      taskRunId: "TR-MCP-OTHER-TOKEN",
      request: current,
      status: "working",
    })]);

    await expect(prepared.data.admissionGuard(fixture.tx as never)).rejects.toMatchObject({
      reason: "immutable-identity-conflict",
      taskRunId: "TR-MCP-OTHER-TOKEN",
    });
  });

  it("refuses a current objective mapping activity even before receipt bookkeeping", async () => {
    const fixture = admissionDb();
    fixture.db.backlogItemActivity.findMany.mockImplementation((async (args: { where: { kind: string } }) => {
      if (args.where.kind === "initiative_scope_baseline") {
        return [{
          id: "BASELINE-CURRENT",
          backlogItemId: "row-bi-atomic",
          kind: "initiative_scope_baseline",
          recordedAt,
          payload: {
            schemaVersion: 1,
            baselineId: "baseline-current",
            supersedesBaselineId: null,
            artifactDigest: "digest-current",
            subject: { kind: "backlog-item", id: "BI-ATOMIC" },
            objectiveStatements: [{ objectiveId: "OBJ-ATOMIC" }],
            acceptanceStatements: [{ acceptanceId: "AC-ATOMIC" }],
            artifactRef: {
              kind: "repo-blob-at-commit",
              repositoryFullName,
              commitSha: artifactCommitSha,
              path: "docs/superpowers/specs/atomic-design.md",
              providerBlobId,
            },
          },
        }];
      }
      if (args.where.kind === "evidence") {
        return ["E-1", "E-2"].map((id) => ({
          id,
          backlogItemId: "row-bi-atomic",
          kind: "evidence",
          recordedAt: new Date(recordedAt.getTime() + 1_000),
          payload: { evidenceKind: "test_pass" },
        }));
      }
      return [{
        id: "MAP-CURRENT",
        backlogItemId: "row-bi-atomic",
        kind: "initiative_objective_mapping",
        recordedAt: new Date(recordedAt.getTime() + 2_000),
        payload: {
          schemaVersion: 1,
          proposalId: "MAP-CURRENT",
          subject: { kind: "backlog-item", id: "BI-ATOMIC" },
          baselineId: "baseline-current",
          artifactDigest: "digest-current",
          mappings: [
            { objectiveId: "OBJ-ATOMIC", evidenceRefs: ["E-1"] },
            { objectiveId: "AC-ATOMIC", evidenceRefs: ["E-2"] },
          ],
        },
      }];
    }) as never);

    const prepared = await prepareObjectiveMappingSubmissionAdmission({
      packet: packet(),
      expectedTaskRunId: "TR-MCP-CURRENT",
      ports: {
        db: fixture.db as never,
        verifyHistoricalArtifact: vi.fn(),
        workroomIsLive: vi.fn().mockResolvedValue(true),
      },
    });

    expect(prepared).toMatchObject({
      ok: false,
      refusal: { reason: "authoritative-output-exists" },
    });
  });

  it("keeps a malformed latest mapping auditable without blocking one valid correction", async () => {
    const fixture = admissionDb();
    const baseFindMany = fixture.db.backlogItemActivity.findMany.getMockImplementation()!;
    fixture.db.backlogItemActivity.findMany.mockImplementation((async (args: { where: { kind: string } }) => {
      if (args.where.kind !== "initiative_objective_mapping") return baseFindMany(args);
      return [{
        id: "MAP-MALFORMED",
        backlogItemId: "row-bi-atomic",
        kind: "initiative_objective_mapping",
        recordedAt: new Date(recordedAt.getTime() + 2_000),
        payload: { baselineId: "baseline-current" },
      }];
    }) as never);

    const prepared = await prepareObjectiveMappingSubmissionAdmission({
      packet: packet(),
      expectedTaskRunId: "TR-MCP-CURRENT",
      ports: {
        db: fixture.db as never,
        verifyHistoricalArtifact: vi.fn(),
        workroomIsLive: vi.fn().mockResolvedValue(true),
      },
    });

    expect(prepared).toMatchObject({ ok: true });
  });

  it("refuses an identity-matching Workroom that canonical liveness classifies as history", async () => {
    const fixture = admissionDb();
    const prepared = await prepareObjectiveMappingSubmissionAdmission({
      packet: packet(),
      expectedTaskRunId: "TR-MCP-CURRENT",
      ports: {
        db: fixture.db as never,
        verifyHistoricalArtifact: vi.fn(),
        workroomIsLive: vi.fn().mockResolvedValue(false),
      },
    });

    expect(prepared).toMatchObject({
      ok: false,
      refusal: { reason: "workroom-identity-conflict" },
    });
  });
});
