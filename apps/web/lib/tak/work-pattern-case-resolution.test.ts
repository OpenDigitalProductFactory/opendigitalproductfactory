import { describe, expect, it } from "vitest";

import type { ReceiptEnvelope } from "@/lib/work-management/receipt-envelope";
import type { WorkPatternReviewState } from "./work-pattern-review";
import type { WorkPatternMetadata } from "./work-pattern-types";
import {
  buildWorkPatternCaseStaging,
  parseWorkPatternCaseStagingState,
} from "./work-pattern-case-staging";
import {
  buildWorkPatternCaseResolution,
  parseWorkPatternCaseResolutionState,
} from "./work-pattern-case-resolution";

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

function stageableProposal() {
  return buildWorkPatternCaseStaging({
    review: approvedReview(),
    metadata: caseBoundMetadata(),
  });
}

function governedReceipt(overrides: Partial<ReceiptEnvelope> = {}): ReceiptEnvelope {
  return {
    receiptId: "receipt-1",
    caseRef: {
      caseId: "backlog-item:BI-123",
      sourceType: "backlog-item",
      sourceId: "BI-123",
    },
    receiptKind: "governed-action",
    enforcementMode: "governed-action",
    sourceRef: {
      kind: "decision-interaction",
      id: "DI-RESOLVE001",
      status: "approved",
    },
    actionType: "propose",
    status: "valid",
    summary: "Governed Work Case proposal approved through receipt-backed action path.",
    occurredAt: "2026-06-28T12:05:00.000Z",
    policyRefs: ["work-case.propose"],
    rawRef: {
      table: "ToolExecutionReceipt",
      id: "receipt-row-1",
    },
    ...overrides,
  };
}

describe("work-pattern-case-resolution", () => {
  it("approves a stageable proposal without receipt as awaiting receipt evidence", () => {
    const resolution = buildWorkPatternCaseResolution({
      staging: stageableProposal(),
      action: "approve",
      decisionInteractionId: "DI-RESOLVE001",
      resolverUserId: "user-1",
      resolvedAt: new Date("2026-06-28T12:05:00.000Z"),
      note: "Approve for governed Work Case action path only.",
    });

    expect(resolution).toMatchObject({
      status: "approved-awaiting-receipt",
      action: "approve",
      activationAllowed: false,
      liveMutationAllowed: false,
      commitAllowed: false,
      receiptCoverage: "required-before-commit",
      receiptId: null,
      decisionInteractionId: "DI-RESOLVE001",
      resolverUserId: "user-1",
      blockers: ["receipt-required-before-commit"],
      stagedTransition: {
        status: "approved",
        caseState: "active",
        a2aStatus: "working",
        committable: true,
      },
    });
  });

  it("approves a proposal with a valid governed receipt as ready for governed commit", () => {
    const resolution = buildWorkPatternCaseResolution({
      staging: stageableProposal(),
      action: "approve",
      decisionInteractionId: "DI-RESOLVE001",
      resolverUserId: "user-1",
      resolvedAt: new Date("2026-06-28T12:05:00.000Z"),
      receipt: governedReceipt(),
    });

    expect(resolution).toMatchObject({
      status: "approved-ready-for-governed-commit",
      action: "approve",
      activationAllowed: false,
      liveMutationAllowed: false,
      commitAllowed: true,
      receiptCoverage: "covered",
      receiptId: "receipt-1",
      blockers: [],
    });
  });

  it("records rejected and deferred proposal resolutions as terminal and non-committable", () => {
    expect(
      buildWorkPatternCaseResolution({
        staging: stageableProposal(),
        action: "reject",
        decisionInteractionId: "DI-RESOLVE002",
        resolverUserId: "user-1",
        resolvedAt: new Date("2026-06-28T12:10:00.000Z"),
      }),
    ).toMatchObject({
      status: "rejected",
      action: "reject",
      commitAllowed: false,
      receiptCoverage: "not-required",
      stagedTransition: {
        status: "rejected",
        terminal: true,
        committable: false,
      },
    });

    expect(
      buildWorkPatternCaseResolution({
        staging: stageableProposal(),
        action: "defer",
        decisionInteractionId: "DI-RESOLVE003",
        resolverUserId: "user-1",
        resolvedAt: new Date("2026-06-28T12:15:00.000Z"),
      }),
    ).toMatchObject({
      status: "deferred",
      action: "defer",
      commitAllowed: false,
      receiptCoverage: "not-required",
      stagedTransition: {
        status: "responded",
        terminal: true,
        committable: false,
      },
    });
  });

  it("blocks approval when staging is not stageable", () => {
    const resolution = buildWorkPatternCaseResolution({
      staging: {
        status: "blocked",
        activationAllowed: false,
        liveMutationAllowed: false,
        receiptCoverage: "blocked",
        blockers: ["missing-sponsor-principal"],
      },
      action: "approve",
      decisionInteractionId: "DI-RESOLVE004",
      resolverUserId: "user-1",
      resolvedAt: new Date("2026-06-28T12:20:00.000Z"),
    });

    expect(resolution).toMatchObject({
      status: "blocked",
      commitAllowed: false,
      receiptCoverage: "blocked",
      blockers: expect.arrayContaining(["case-proposal-not-stageable"]),
    });
  });

  it("parses persisted resolution state and preserves it on case staging", () => {
    const resolution = buildWorkPatternCaseResolution({
      staging: stageableProposal(),
      action: "approve",
      decisionInteractionId: "DI-RESOLVE001",
      resolverUserId: "user-1",
      resolvedAt: new Date("2026-06-28T12:05:00.000Z"),
    });

    expect(parseWorkPatternCaseResolutionState(resolution)).toMatchObject({
      status: "approved-awaiting-receipt",
      commitAllowed: false,
    });
    expect(parseWorkPatternCaseResolutionState({ status: "approved-awaiting-receipt" })).toBeNull();

    const parsedStaging = parseWorkPatternCaseStagingState({
      ...stageableProposal(),
      resolution,
    });
    expect(parsedStaging?.resolution).toMatchObject({
      status: "approved-awaiting-receipt",
      decisionInteractionId: "DI-RESOLVE001",
    });
  });
});
