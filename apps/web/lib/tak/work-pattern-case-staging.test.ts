import { describe, expect, it } from "vitest";

import type { WorkPatternReviewState } from "./work-pattern-review";
import type { WorkPatternMetadata } from "./work-pattern-types";
import {
  buildWorkPatternCaseStaging,
  parseWorkPatternCaseStagingState,
} from "./work-pattern-case-staging";

function approvedReview(overrides: Partial<WorkPatternReviewState> = {}): WorkPatternReviewState {
  return {
    action: "approve",
    status: "approved-candidate",
    needId: "NEED-1",
    agentId: "build-specialist",
    patternKey: "case-proposal|build-specialist|backlog-item",
    routeContext: "/build",
    riskClass: "internal-reversible",
    decisionScope: "company-wwwd",
    decisionInteractionId: "DI-REVIEW001",
    reviewerUserId: "user-1",
    reviewedAt: "2026-06-28T12:00:00.000Z",
    reviewerNote: "Approve as a Work Case proposal only.",
    blockers: ["activation-candidate-awaits-governed-promotion"],
    activationProposed: true,
    activationCandidate: {
      state: "candidate",
      activationAllowed: false,
      patternKey: "case-proposal|build-specialist|backlog-item",
      agentId: "build-specialist",
      routeContext: "/build",
      riskClass: "internal-reversible",
      decisionScope: "company-wwwd",
      currentAutonomyLevel: "shadow",
      proposedAutonomyLevel: "propose",
      evidenceSummary: {
        samples: 20,
        agreements: 19,
        agreementRate: 0.95,
      },
      blockers: ["activation-candidate-awaits-governed-promotion"],
    },
    ...overrides,
  };
}

function caseBoundMetadata(overrides: Partial<WorkPatternMetadata> = {}): WorkPatternMetadata {
  return {
    patternKey: "case-proposal|build-specialist|backlog-item",
    status: "approved",
    scope: "case-transition",
    version: 1,
    source: "human-review",
    decisionScope: "company-wwwd",
    evidence: [{ workCaseRef: "backlog-item:BI-123", taskRunId: "TR-1" }],
    candidate: {
      kind: "other",
      need: "Suggest the next Work Case move",
      blocks: "The coworker repeatedly asks what to do next.",
      fingerprint: "fp-case-proposal",
    },
    workCaseBinding: {
      caseType: "backlog-item",
      transitionKey: "request-input",
      governedActionKey: "propose",
      authorityMode: "autonomous",
      sponsorPrincipalId: "prn_user_1",
      receiptPolicy: "governed-action",
    },
    observedAt: "2026-06-28T11:00:00.000Z",
    ...overrides,
  };
}

describe("work-pattern-case-staging", () => {
  it("projects approved case-bound candidates as non-committable Work Case proposals", () => {
    const state = buildWorkPatternCaseStaging({
      review: approvedReview(),
      metadata: caseBoundMetadata(),
    });

    expect(state).toMatchObject({
      status: "stageable",
      activationAllowed: false,
      liveMutationAllowed: false,
      action: "propose",
      caseRef: {
        caseId: "backlog-item:BI-123",
        sourceType: "backlog-item",
        sourceId: "BI-123",
      },
      enforcementMode: "governed-action",
      requiredReceiptKind: "governed-action",
      receiptCoverage: "required-before-commit",
      stagedTransition: {
        status: "proposed",
        caseState: "awaiting-decision",
        a2aStatus: "input-required",
        committable: false,
        sourceRef: {
          kind: "decision-interaction",
          id: "DI-REVIEW001",
        },
      },
      proposalRail: {
        kind: "coworker-action-envelope-preview",
        envelopeStatus: "proposed",
        manifestActionId: "work-case.propose",
      },
    });
    expect(state.blockers).toContain("receipt-required-before-commit");
  });

  it("blocks case-bound candidates that omit receipt policy", () => {
    const state = buildWorkPatternCaseStaging({
      review: approvedReview(),
      metadata: caseBoundMetadata({
        workCaseBinding: {
          caseType: "backlog-item",
          governedActionKey: "propose",
          authorityMode: "autonomous",
          sponsorPrincipalId: "prn_user_1",
        },
      }),
    });

    expect(state).toMatchObject({
      status: "blocked",
      receiptCoverage: "blocked",
    });
    expect(state.blockers).toContain("missing-receipt-policy");
  });

  it("blocks agent proposals without a sponsor principal", () => {
    const state = buildWorkPatternCaseStaging({
      review: approvedReview(),
      metadata: caseBoundMetadata({
        workCaseBinding: {
          caseType: "backlog-item",
          governedActionKey: "propose",
          authorityMode: "autonomous",
          receiptPolicy: "governed-action",
        },
      }),
    });

    expect(state).toMatchObject({
      status: "blocked",
      receiptCoverage: "blocked",
    });
    expect(state.blockers).toContain("missing-sponsor-principal");
  });

  it("does not stage non-case-bound or non-approved reviews", () => {
    expect(
      buildWorkPatternCaseStaging({
        review: approvedReview(),
        metadata: {
          ...caseBoundMetadata(),
          scope: "route",
          workCaseBinding: undefined,
        },
      }),
    ).toMatchObject({ status: "not-case-bound", receiptCoverage: "not-required" });

    expect(
      buildWorkPatternCaseStaging({
        review: approvedReview({
          action: "reject",
          status: "rejected",
          activationProposed: false,
          activationCandidate: null,
        }),
        metadata: caseBoundMetadata(),
      }),
    ).toMatchObject({ status: "not-case-bound", receiptCoverage: "not-required" });
  });

  it("parses persisted case staging state and rejects malformed records", () => {
    const state = buildWorkPatternCaseStaging({
      review: approvedReview(),
      metadata: caseBoundMetadata(),
    });

    expect(parseWorkPatternCaseStagingState(state)).toMatchObject({
      status: "stageable",
      action: "propose",
      receiptCoverage: "required-before-commit",
    });
    expect(parseWorkPatternCaseStagingState({ status: "stageable" })).toBeNull();
    expect(parseWorkPatternCaseStagingState(null)).toBeNull();
  });
});
