import { describe, expect, it, vi } from "vitest";

import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";

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
