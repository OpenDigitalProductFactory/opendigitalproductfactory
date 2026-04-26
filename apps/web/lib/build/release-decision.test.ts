import { describe, expect, it } from "vitest";
import { deriveReleaseDecisionCards, isMissingReleasableDiffError } from "@/lib/build/release-decision";
import type { BuildFlowState } from "@/lib/build-flow-state";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { normalizeHappyPathState } from "@/lib/feature-build-types";

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "build-row-1",
    buildId: "FB-9B19098C",
    title: "Fix Build Studio header/content overlap in workflow view",
    description: null,
    portfolioId: null,
    originatingBacklogItemId: "backlog-row-1",
    brief: {
      title: "Fix Build Studio header/content overlap in workflow view",
      description: "Fix the overlapping shell layout in Build Studio.",
      portfolioContext: "Foundational",
      targetRoles: ["operator"],
      inputs: [],
      dataNeeds: "Existing build shell metadata",
      acceptanceCriteria: ["Header does not overlap content"],
    },
    plan: null,
    phase: "ship",
    sandboxId: "sandbox-1",
    sandboxPort: 4321,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date("2026-04-25T12:00:00Z"),
    updatedAt: new Date("2026-04-25T12:00:00Z"),
    draftApprovedAt: new Date("2026-04-25T12:10:00Z"),
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: {
      testsPassed: 1,
      testsFailed: 0,
      typecheckPassed: true,
      fullOutput: "typecheck clean",
      timestamp: "2026-04-25T12:30:00Z",
    },
    acceptanceMet: [{ criterion: "Header does not overlap content", met: true, evidence: "Verified in preview" }],
    scoutFindings: null,
    uxTestResults: [{ step: "Header does not overlap", passed: true, screenshotUrl: null, error: null }],
    uxVerificationStatus: "complete",
    accountableEmployeeId: null,
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    deliberationSummary: null,
    originator: null,
    phaseHandoffs: [],
    happyPathState: normalizeHappyPathState(null),
    ...overrides,
  };
}

function makeFlow(overrides: Partial<BuildFlowState> = {}): BuildFlowState {
  return {
    buildId: "FB-9B19098C",
    currentPhase: "ship",
    mainTrack: [],
    upstream: {
      state: "in_progress",
      prUrl: null,
      prNumber: null,
      packId: null,
      errorMessage: null,
    },
    promote: {
      state: "in_progress",
      promotionId: null,
      deployedAt: null,
      scheduleDescription: null,
      rollbackReason: null,
      errorMessage: null,
    },
    allApplicableForksTerminal: false,
    ...overrides,
  };
}

describe("deriveReleaseDecisionCards", () => {
  it("shows release preparation as the next readiness step when no diff exists yet", () => {
    const cards = deriveReleaseDecisionCards(makeBuild(), makeFlow());
    const readiness = cards.find((card) => card.title === "Release Readiness");

    expect(readiness?.label).toBe("Prepare release");
    expect(readiness?.tone).toBe("warning");
  });

  it("shows promotion creation readiness once the diff exists", () => {
    const cards = deriveReleaseDecisionCards(
      makeBuild({ diffPatch: "diff --git a/file b/file", diffSummary: "1 file changed" }),
      makeFlow(),
    );
    const readiness = cards.find((card) => card.title === "Release Readiness");

    expect(readiness?.label).toBe("Ready to register");
    expect(readiness?.tone).toBe("ready");
  });

  it("shows deployed and shared terminal states after both release forks finish", () => {
    const cards = deriveReleaseDecisionCards(
      makeBuild({ diffPatch: "diff --git a/file b/file", diffSummary: "1 file changed", digitalProductId: "dp-1" }),
      makeFlow({
        upstream: {
          state: "shipped",
          prUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/999",
          prNumber: 999,
          packId: "FP-1",
          errorMessage: null,
        },
        promote: {
          state: "shipped",
          promotionId: "CP-12345678",
          deployedAt: new Date("2026-04-25T13:00:00Z"),
          scheduleDescription: null,
          rollbackReason: null,
          errorMessage: null,
        },
      }),
    );

    expect(cards.find((card) => card.title === "Community Sharing")?.label).toBe("Shared upstream");
    expect(cards.find((card) => card.title === "Deployment Timing")?.label).toBe("Deployed");
  });

  it("detects the specific no-diff release failure so the UI can offer implementation recovery", () => {
    expect(
      isMissingReleasableDiffError(
        "No releasable source changes were found in the sandbox. This build currently has only generated/cache churn or no real code changes, so release preparation cannot continue until implementation produces a real source diff.",
      ),
    ).toBe(true);
    expect(isMissingReleasableDiffError("Some other release problem")).toBe(false);
  });
});
