import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    workCapsule: { findUnique: vi.fn() },
    externalEvidenceRecord: { findFirst: vi.fn() },
  },
  recordExternalEvidence: vi.fn(),
  recordWorkCapsuleEvidence: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: mocks.recordExternalEvidence }));
vi.mock("@/lib/change-review/routed-semantic-review", () => ({ dispatchRoutedSemanticReview: vi.fn() }));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence: mocks.recordWorkCapsuleEvidence }));

import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { changeReviewPack } from "./change-review-pack";

describe("change-review MCP pack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.workCapsule.findUnique.mockResolvedValue({ id: "capsule-row-1" });
    mocks.recordExternalEvidence.mockResolvedValue({ id: "outcome-evidence-1" });
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
