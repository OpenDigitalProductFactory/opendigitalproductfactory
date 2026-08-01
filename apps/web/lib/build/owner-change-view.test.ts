import { describe, expect, it } from "vitest";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { projectOwnerChangeView } from "./owner-change-view";

function build(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "feature-build-row-a",
    buildId: "FB-CHANGE-A",
    title: "Make booking changes easier",
    description: "Let customers change a booking online.",
    portfolioId: null,
    originatingBacklogItemId: null,
    brief: null,
    businessBuildBrief: null,
    plan: null,
    phase: "review",
    sandboxId: "sandbox-a",
    sandboxPort: 3035,
    diffSummary: "Added self-service booking changes.",
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "user-a",
    createdAt: new Date("2026-07-30T10:00:00.000Z"),
    updatedAt: new Date("2026-07-30T12:00:00.000Z"),
    draftApprovedAt: null,
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
    scoutFindings: null,
    uxTestResults: null,
    uxVerificationStatus: null,
    accountableEmployeeId: null,
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    deliberationSummary: null,
    originator: null,
    phaseHandoffs: null,
    happyPathState: {
      version: 1,
      mode: "standard",
      state: "pending",
      reason: null,
      updatedAt: null,
    },
    ...overrides,
  } as FeatureBuildRow;
}

describe("projectOwnerChangeView", () => {
  it("uses the selected Change's canonical business outcome", () => {
    const view = projectOwnerChangeView({
      build: build({
        businessBuildBrief: {
          briefId: "BBB-CHANGE-A",
          title: "Make booking changes easier",
          status: "accepted",
          intakeSource: "user_conversation",
          businessOutcome: "Customers can change a booking without calling.",
          affectedPeople: ["Customer"],
          affectedWorkflow: "Booking changes",
          sourceEvidence: [],
          successSignals: ["Fewer change calls"],
          constraints: [],
          businessInterpretation: "Reduce avoidable calls.",
          capabilityPackId: "operations",
          capabilityPack: "Operations",
          riskProfile: {
            customerFacing: true,
            complianceSensitive: false,
            revenueImpacting: false,
            operationalRisk: false,
            level: "medium",
          },
          technicalInterpretation: {
            dataNeeds: null,
            likelyWorkflowImpact: [],
            verificationFocus: [],
          },
          openQuestions: [],
          confidence: "high",
        },
      }),
      previewDrivingBuildId: "FB-CHANGE-A",
    });

    expect(view.changeId).toBe("FB-CHANGE-A");
    expect(view.outcome).toBe("Customers can change a booking without calling.");
    expect(view.preview).toEqual({ available: true, drivingThisChange: true });
  });

  it("distinguishes passed, failed, not-applicable, not-recorded, and stale proof", () => {
    const passed = projectOwnerChangeView({
      build: build({
        verificationOut: {
          testsPassed: 12,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "ok",
          timestamp: "2026-07-30T12:00:00.000Z",
        },
        acceptanceMet: [{ criterion: "Customer can reschedule", met: true, evidence: "Verified" }],
        uxVerificationStatus: "complete",
      }),
    });
    expect(passed.proof.checks.map((check) => check.state)).toEqual([
      "passed",
      "passed",
      "passed",
    ]);

    const failed = projectOwnerChangeView({
      build: build({
        verificationOut: {
          testsPassed: 11,
          testsFailed: 1,
          typecheckPassed: true,
          fullOutput: "one failure",
          timestamp: "2026-07-30T12:00:00.000Z",
        },
        acceptanceMet: [{ criterion: "Customer can reschedule", met: false, evidence: "Button failed" }],
        uxVerificationStatus: "failed",
      }),
    });
    expect(failed.proof.checks.map((check) => check.state)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);

    const missing = projectOwnerChangeView({ build: build() });
    expect(missing.proof.checks.map((check) => check.state)).toEqual([
      "not-recorded",
      "not-recorded",
      "not-recorded",
    ]);

    const notApplicable = projectOwnerChangeView({
      build: build({ phase: "plan", uxVerificationStatus: "skipped" }),
    });
    expect(notApplicable.proof.checks.map((check) => check.state)).toEqual([
      "not-applicable",
      "not-applicable",
      "not-applicable",
    ]);

    const stale = projectOwnerChangeView({
      build: build({
        verificationOut: {
          testsPassed: 12,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "ok",
          timestamp: "2026-07-30T11:49:59.000Z",
        },
      }),
    });
    expect(stale.proof.checks.find((check) => check.key === "automated")?.state).toBe("stale");
  });

  it("projects plain-language status, Needs You, and pending decision identity", () => {
    const view = projectOwnerChangeView({
      build: build({
        decisionInteraction: {
          interactionId: "DI-OWNER-1",
          outcomeType: "escalate",
          chosenOptionId: null,
        } as FeatureBuildRow["decisionInteraction"],
      }),
      status: {
        lifecyclePosition: "Waiting for your decision",
        nextAction: "Choose whether to release this change.",
        needsYou: true,
      },
    });

    expect(view).toMatchObject({
      now: "Waiting for your decision",
      next: "Choose whether to release this change.",
      health: "needs-you",
      pendingDecisionId: "DI-OWNER-1",
    });
  });
});
