import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    workroom: { findUnique: vi.fn() },
    externalEvidenceRecord: { findFirst: vi.fn(), findUnique: vi.fn() },
    taskRun: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  recordExternalEvidence: vi.fn(),
  recordWorkCapsuleEvidence: vi.fn(),
  dispatchRoutedSemanticReview: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: mocks.recordExternalEvidence }));
vi.mock("@/lib/change-review/routed-semantic-review", () => ({
  dispatchRoutedSemanticReview: mocks.dispatchRoutedSemanticReview,
}));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence: mocks.recordWorkCapsuleEvidence }));

import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { changeReviewPack } from "./change-review-pack";

const taskRows: Array<Record<string, unknown>> = [];

describe("change-review MCP pack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskRows.length = 0;
    mocks.prisma.workroom.findUnique.mockResolvedValue({ id: "capsule-row-1" });
    mocks.prisma.externalEvidenceRecord.findFirst.mockResolvedValue(null);
    mocks.prisma.externalEvidenceRecord.findUnique.mockResolvedValue(null);
    mocks.recordExternalEvidence.mockResolvedValue({ id: "outcome-evidence-1" });
    mocks.dispatchRoutedSemanticReview.mockResolvedValue({
      decision: "pass",
      issues: [],
      summary: "The exact change passes semantic review.",
    });
    mocks.prisma.taskRun.findMany.mockImplementation(async ({ where }) =>
      taskRows.filter((row) => row.repeatedPatternKey === where.repeatedPatternKey));
    mocks.prisma.taskRun.findUnique.mockImplementation(async ({ where }) =>
      taskRows.find((row) => row.taskRunId === where.taskRunId) ?? null);
    mocks.prisma.taskRun.create.mockImplementation(async ({ data }) => {
      if (taskRows.some((row) => row.taskRunId === data.taskRunId)) {
        throw Object.assign(new Error("duplicate TaskRun"), { code: "P2002" });
      }
      const row = {
        ...data,
        progressPayload: null,
        createdAt: new Date(),
      };
      taskRows.push(row);
      return row;
    });
    mocks.prisma.taskRun.update.mockImplementation(async ({ where, data }) => {
      const row = taskRows.find((candidate) => candidate.taskRunId === where.taskRunId);
      if (!row) throw new Error("missing TaskRun");
      Object.assign(row, data);
      return row;
    });
  });

  it("exposes native review and outcome-correlation operations", () => {
    expect(changeReviewPack.definitions.map((definition) => definition.name)).toEqual([
      "review_semantic_change",
      "record_semantic_review_outcome",
    ]);
    expect(Object.keys(changeReviewPack.handlers)).toEqual([
      "review_semantic_change",
      "record_semantic_review_outcome",
    ]);
  });

  it("requires evidence-writing authority", () => {
    expect(changeReviewPack.grants.review_semantic_change).toEqual(["backlog_write"]);
    expect(changeReviewPack.grants.record_semantic_review_outcome).toEqual(["backlog_write"]);
    expect(isToolAllowedByGrants("review_semantic_change", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("review_semantic_change", ["view_platform"])).toBe(false);
  });

  it("requires receipt and GitHub/CI correlation identity", () => {
    const definition = changeReviewPack.definitions.find(
      (candidate) => candidate.name === "record_semantic_review_outcome",
    )!;
    expect(definition.inputSchema.required).toEqual(expect.arrayContaining([
      "capsuleId",
      "receiptId",
      "surface",
      "pullRequestNumber",
      "ciPassed",
      "merged",
    ]));
  });

  it("requires an immutable tree identity and exact artifact", () => {
    const definition = changeReviewPack.definitions[0]!;
    expect(definition.inputSchema.required).toEqual(expect.arrayContaining([
      "capsuleId",
      "baseTreeHash",
      "headTreeHash",
      "diffDigest",
      "artifact",
      "verificationEvidence",
    ]));
  });

  it("dispatches one semantic review and subscribes a concurrent equivalent caller", async () => {
    const input = {
      capsuleId: "WC-SINGLE-FLIGHT",
      authorSurface: "codex-desktop",
      artifactType: "code-change",
      title: "Immutable gate coordination",
      artifact: "diff --git a/file.ts b/file.ts",
      verificationEvidence: "Focused tests passed.",
      changedFiles: ["apps/web/lib/file.ts"],
      baseTreeHash: "a".repeat(40),
      headTreeHash: "b".repeat(40),
      diffDigest: "c".repeat(64),
    };

    const [left, right] = await Promise.all([
      changeReviewPack.handlers.review_semantic_change!(input, "user-1", { agentId: "codex" }),
      changeReviewPack.handlers.review_semantic_change!(input, "user-1", { agentId: "codex" }),
    ]);

    expect([left.data?.disposition, right.data?.disposition].sort())
      .toEqual(["admitted", "subscribed"]);
    expect(mocks.dispatchRoutedSemanticReview).toHaveBeenCalledOnce();
    expect(mocks.recordExternalEvidence).toHaveBeenCalledOnce();
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0]).toMatchObject({ status: "completed" });
  });

  it("records infrastructure-inconclusive correlation without semantic quality counts", async () => {
    mocks.prisma.externalEvidenceRecord.findFirst
      .mockResolvedValueOnce({
        details: {
          schemaVersion: "semantic-change-review-receipt.v2",
          capsuleId: "WC-CALIBRATION",
          baseTreeHash: "a".repeat(40),
          headTreeHash: "b".repeat(40),
          diffDigest: "c".repeat(64),
          policyVersion: "semantic-change-review-policy.v2",
          reviewerVersion: "change-reviewer.v1",
          specialistIds: [],
          disposition: "reviewed",
          risk: "high",
          result: {
            decision: "inconclusive",
            issues: [],
            summary: "Review capacity was unavailable.",
            inconclusiveReason: "capacity-exhausted",
          },
          reviewedAt: "2026-08-01T16:00:00.000Z",
        },
      })
      .mockResolvedValueOnce(null);

    const result = await changeReviewPack.handlers.record_semantic_review_outcome!({
      capsuleId: "WC-CALIBRATION",
      receiptId: "receipt-inconclusive",
      surface: "external",
      pullRequestNumber: 4001,
      ciPassed: true,
      merged: true,
      acceptedFindingCount: 9,
      falsePositiveFindingCount: 4,
    }, "user-1", { agentId: "change-reviewer" });

    expect(result.success).toBe(true);
    expect(mocks.recordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({
      target: "receipt-inconclusive",
      details: expect.objectContaining({
        correlationStatus: "infrastructure-inconclusive",
        acceptedFindingCount: 0,
        falsePositiveFindingCount: 0,
      }),
    }));
    expect(mocks.recordWorkCapsuleEvidence).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing correlation for the same receipt", async () => {
    mocks.prisma.externalEvidenceRecord.findFirst
      .mockResolvedValueOnce({
        details: {
          schemaVersion: "semantic-change-review-receipt.v2",
          result: { decision: "pass", issues: [], summary: "Passed." },
        },
      })
      .mockResolvedValueOnce({
        id: "existing-outcome-1",
        resultSummary: "Already correlated.",
        details: { receiptId: "receipt-pass" },
      });

    const result = await changeReviewPack.handlers.record_semantic_review_outcome!({
      capsuleId: "WC-CALIBRATION",
      receiptId: "receipt-pass",
      surface: "external",
      pullRequestNumber: 4002,
      ciPassed: true,
      merged: true,
    }, "user-1", { agentId: "change-reviewer" });

    expect(result).toMatchObject({ success: true, entityId: "existing-outcome-1" });
    expect(mocks.recordExternalEvidence).not.toHaveBeenCalled();
    expect(mocks.recordWorkCapsuleEvidence).not.toHaveBeenCalled();
  });
});
