import { describe, expect, it } from "vitest";

import {
  aggregateSemanticReviewOutcomes,
  evaluateSemanticReviewPublicationControl,
  projectSemanticReviewOutcome,
  type SemanticReviewOutcome,
} from "./semantic-review-enforcement";
import {
  CHANGE_REVIEW_POLICY_VERSION,
  CHANGE_REVIEWER_VERSION,
  createSemanticReviewReceipt,
  type SemanticReviewIdentity,
  type SemanticReviewReceipt,
} from "./semantic-change-review";

const now = new Date("2026-08-01T16:00:00.000Z");
const identity: SemanticReviewIdentity = {
  capsuleId: "WC-CALIBRATION",
  baseTreeHash: "a".repeat(40),
  headTreeHash: "b".repeat(40),
  diffDigest: "c".repeat(64),
  policyVersion: CHANGE_REVIEW_POLICY_VERSION,
  reviewerVersion: CHANGE_REVIEWER_VERSION,
  specialistIds: ["AGT-181"],
};

function receipt(overrides: Partial<SemanticReviewReceipt> = {}): SemanticReviewReceipt {
  return {
    ...createSemanticReviewReceipt({
      identity,
      disposition: "reviewed",
      risk: "high",
      result: { decision: "pass", issues: [], summary: "No blocking findings." },
    }),
    ...overrides,
  };
}

describe("deterministic semantic-review publication control", () => {
  it("observes a missing receipt in shadow mode and blocks it in enforce mode", () => {
    expect(evaluateSemanticReviewPublicationControl({ mode: "shadow", identity, receipt: null, now }))
      .toMatchObject({ disposition: "shadow-observe", reason: "missing-receipt", mayPublish: true });
    expect(evaluateSemanticReviewPublicationControl({ mode: "enforce", identity, receipt: null, now }))
      .toMatchObject({ disposition: "block", reason: "missing-receipt", mayPublish: false });
  });

  it("blocks a stale receipt and allows a fresh completed pass", () => {
    expect(evaluateSemanticReviewPublicationControl({
      mode: "enforce",
      identity,
      receipt: receipt({ headTreeHash: "d".repeat(40) }),
      now,
    })).toMatchObject({ disposition: "block", reason: "stale-receipt", mayPublish: false });

    expect(evaluateSemanticReviewPublicationControl({ mode: "enforce", identity, receipt: receipt(), now }))
      .toMatchObject({ disposition: "allow", reason: "fresh-receipt", mayPublish: true });
  });

  it("distinguishes an infrastructure-inconclusive receipt from a semantic failure", () => {
    const inconclusive = receipt({
      result: {
        decision: "inconclusive",
        issues: [],
        summary: "Review capacity was unavailable.",
        inconclusiveReason: "review-branch-capacity-exhausted",
      },
    });
    expect(evaluateSemanticReviewPublicationControl({ mode: "enforce", identity, receipt: inconclusive, now }))
      .toMatchObject({ disposition: "block", reason: "infrastructure-inconclusive", mayPublish: false });
  });

  it("allows only a current, expiry-bound, evidenced policy exemption", () => {
    const exemption = {
      schemaVersion: "semantic-change-review-exemption.v1" as const,
      policyVersion: CHANGE_REVIEW_POLICY_VERSION,
      capsuleId: identity.capsuleId,
      diffDigest: identity.diffDigest,
      evidenceId: "cms-evidence-1",
      reason: "Generated release metadata only; reviewed policy exemption.",
      expiresAt: "2026-08-01T17:00:00.000Z",
    };
    expect(evaluateSemanticReviewPublicationControl({ mode: "enforce", identity, receipt: null, exemption, now }))
      .toMatchObject({ disposition: "allow", reason: "policy-exemption", mayPublish: true });

    expect(evaluateSemanticReviewPublicationControl({
      mode: "enforce",
      identity,
      receipt: null,
      exemption: { ...exemption, expiresAt: "2026-08-01T15:00:00.000Z" },
      now,
    })).toMatchObject({ disposition: "block", reason: "invalid-exemption", mayPublish: false });
  });
});

describe("semantic-review outcome telemetry", () => {
  const completed = (overrides: Partial<SemanticReviewOutcome> = {}): SemanticReviewOutcome => ({
    schemaVersion: "semantic-change-review-outcome.v1",
    receiptId: "receipt-1",
    capsuleId: "WC-EXTERNAL",
    surface: "external",
    reviewDisposition: "reviewed",
    reviewDecision: "pass",
    correlationStatus: "completed",
    acceptedFindingCount: 1,
    falsePositiveFindingCount: 0,
    uniqueLocalFindingCount: 1,
    postPublicationMissCount: 0,
    correctivePushCount: 1,
    timeToFirstSignalMs: 1_200,
    costUsd: 0.04,
    github: { pullRequestNumber: 4000, ciPassed: true, merged: true },
    recordedAt: "2026-08-01T16:00:00.000Z",
    ...overrides,
  });

  it("excludes infrastructure-inconclusive samples from precision and unique-yield denominators", () => {
    const metrics = aggregateSemanticReviewOutcomes([
      completed(),
      completed({
        receiptId: "receipt-2",
        capsuleId: "WC-STUDIO",
        surface: "build-studio",
        reviewDecision: "inconclusive",
        correlationStatus: "infrastructure-inconclusive",
        acceptedFindingCount: 0,
        uniqueLocalFindingCount: 0,
        correctivePushCount: 0,
        timeToFirstSignalMs: null,
        costUsd: null,
      }),
    ]);

    expect(metrics).toMatchObject({
      totalSamples: 2,
      completedSamples: 1,
      infrastructureInconclusiveSamples: 1,
      precision: 1,
      uniqueYieldPerCompletedSample: 1,
      postPublicationMissRate: 0,
    });
  });

  it("projects outcome correlation into the existing evidence and activity streams", () => {
    const projection = projectSemanticReviewOutcome(completed());
    expect(projection.externalEvidence.operationType).toBe("semantic-change-review.outcome");
    expect(projection.externalEvidence.target).toBe("receipt-1");
    expect(projection.activity.kind).toBe("evidence-recorded");
    expect(projection.externalEvidence.details).toEqual(projection.activity.payload);
  });
});
