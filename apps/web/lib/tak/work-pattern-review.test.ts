import { describe, expect, it } from "vitest";

import type { WorkPatternShadowEvaluation } from "./work-pattern-shadow-evaluation";
import {
  buildWorkPatternReview,
  capabilityNeedStatusForReviewAction,
  mergeWorkPatternReviewState,
  parseWorkPatternReviewState,
  type BuildWorkPatternReviewInput,
  workPatternReviewStatusForAction,
} from "./work-pattern-review";

function promotableShadowEvaluation(): WorkPatternShadowEvaluation {
  return {
    samples: 20,
    agreements: 19,
    agreementRate: 0.95,
    riskClass: "internal-reversible",
    currentLevel: "shadow",
    trustRecommendation: {
      action: "promote",
      from: "shadow",
      to: "propose",
      reason: "agreement 95% >= 90% over 20 samples",
    },
    decision: "approve-narrower-scope",
    activationAllowed: false,
    improvementTotals: {
      toolCallDelta: -3,
      failureDelta: -1,
      manualTouchDelta: 0,
      contextTokenDelta: -100,
      reviewFailureDelta: 0,
    },
    blockers: [],
  };
}

function baseInput(overrides: Partial<BuildWorkPatternReviewInput> = {}): BuildWorkPatternReviewInput {
  const input: BuildWorkPatternReviewInput = {
    action: "approve" as const,
    needId: "NEED-1",
    agentId: "build-specialist",
    patternKey: "grant-denial|build-specialist|/build",
    routeContext: "/build",
    riskClass: "internal-reversible",
    decisionScope: "platform-wwmd" as const,
    candidate: {
      kind: "grant" as const,
      need: "Missing sandbox lease grant",
      blocks: "Repeated grant denials block verification.",
      fingerprint: "fp-grant",
    },
    shadowEvaluation: promotableShadowEvaluation(),
    decisionInteractionId: "DI-REVIEW001",
    reviewerUserId: "user-1",
    reviewedAt: new Date("2026-06-28T12:00:00.000Z"),
  };
  return { ...input, ...overrides };
}

describe("work-pattern-review", () => {
  it("creates a scoped activation candidate for an approved promotable shadow pattern", () => {
    const review = buildWorkPatternReview(baseInput());

    expect(review).toMatchObject({
      action: "approve",
      status: "approved-candidate",
      needId: "NEED-1",
      decisionInteractionId: "DI-REVIEW001",
      activationProposed: true,
    });
    expect(review.activationCandidate).toMatchObject({
      state: "candidate",
      activationAllowed: false,
      patternKey: "grant-denial|build-specialist|/build",
      agentId: "build-specialist",
      routeContext: "/build",
      riskClass: "internal-reversible",
      currentAutonomyLevel: "shadow",
      proposedAutonomyLevel: "propose",
      decisionScope: "platform-wwmd",
    });
    expect(review.blockers).toContain("activation-candidate-awaits-governed-promotion");
  });

  it("blocks approval when the shadow decision is not promotable", () => {
    expect(() =>
      buildWorkPatternReview(
        baseInput({
          shadowEvaluation: {
            ...promotableShadowEvaluation(),
            trustRecommendation: { action: "hold", level: "shadow", reason: "not enough evidence" },
            decision: "continue-shadow",
          },
        }),
      ),
    ).toThrow("approval_requires_promotable_shadow_evidence");
  });

  it("preserves rejected review state in readiness JSON without proposing activation", () => {
    const review = buildWorkPatternReview(
      baseInput({
        action: "reject",
        shadowEvaluation: null,
        candidate: null,
      }),
    );
    const merged = mergeWorkPatternReviewState(
      {
        readyForReview: true,
        readyForCaseActivation: false,
        blockers: ["pattern-status-not-approved-or-active"],
      },
      review,
    );

    expect(merged).toMatchObject({
      readyForReview: true,
      activationProposed: false,
    });
    expect(parseWorkPatternReviewState(merged)).toMatchObject({
      action: "reject",
      status: "rejected",
      decisionInteractionId: "DI-REVIEW001",
      activationCandidate: null,
    });
  });

  it("maps review actions to need statuses and review statuses", () => {
    expect(capabilityNeedStatusForReviewAction("approve")).toBe("accepted");
    expect(capabilityNeedStatusForReviewAction("defer")).toBe("deferred");
    expect(capabilityNeedStatusForReviewAction("reject")).toBe("discarded");
    expect(workPatternReviewStatusForAction("approve")).toBe("approved-candidate");
    expect(workPatternReviewStatusForAction("defer")).toBe("deferred");
    expect(workPatternReviewStatusForAction("reject")).toBe("rejected");
  });
});
