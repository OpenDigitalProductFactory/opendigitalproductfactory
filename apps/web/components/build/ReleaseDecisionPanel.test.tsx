import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildFlowState } from "@/lib/build-flow-state";
import { normalizeHappyPathState, type FeatureBuildRow } from "@/lib/feature-build-types";
import { ReleaseDecisionPanel } from "@/components/build/ReleaseDecisionPanel";

function makeRow(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "1",
    buildId: "FB-TEST",
    title: "Release Workflow Test",
    description: null,
    portfolioId: null,
    originatingBacklogItemId: null,
    brief: null,
    plan: null,
    phase: "ship",
    sandboxId: "sandbox-1",
    sandboxPort: 3035,
    diffSummary: "Adds governed release workflow decisions.",
    diffPatch: "diff --git a/a b/a",
    codingProvider: null,
    threadId: null,
    digitalProductId: "dp-1",
    product: { productId: "DP-001", version: "1.2.0", backlogCount: 3 },
    createdById: "u1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    draftApprovedAt: null,
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: {
      testsPassed: 12,
      testsFailed: 0,
      typecheckPassed: true,
      fullOutput: "ok",
      timestamp: new Date("2026-01-01").toISOString(),
    },
    acceptanceMet: [
      { criterion: "Sandbox preview matches the requested workflow", met: true, evidence: "Preview verified." },
    ],
    scoutFindings: null,
    uxTestResults: [{ step: "Open release review", passed: true, screenshotUrl: null, error: null }],
    uxVerificationStatus: "complete",
    accountableEmployeeId: null,
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    deliberationSummary: null,
    originator: null,
    phaseHandoffs: null,
    happyPathState: normalizeHappyPathState(null),
    ...overrides,
  };
}

describe("ReleaseDecisionPanel", () => {
  it("renders community sharing, release readiness, and deployment timing cards", () => {
    const build = makeRow();
    const flowState: BuildFlowState = {
      buildId: build.buildId,
      currentPhase: "ship",
      mainTrack: [
        { phase: "ideate", label: "Ideate", stepsCompleted: 3, stepsTotal: 3, state: "done" },
        { phase: "plan", label: "Plan", stepsCompleted: 2, stepsTotal: 2, state: "done" },
        { phase: "build", label: "Build", stepsCompleted: 4, stepsTotal: 4, state: "done" },
        { phase: "review", label: "Review", stepsCompleted: 4, stepsTotal: 4, state: "done" },
        { phase: "ship", label: "Ready to Ship", stepsCompleted: 1, stepsTotal: 2, state: "active" },
      ],
      upstream: {
        state: "shipped",
        prUrl: "https://github.com/dpf/repo/pull/42",
        prNumber: 42,
        packId: "FP-1",
        errorMessage: null,
      },
      promote: {
        state: "scheduled",
        promotionId: "CP-1",
        deployedAt: null,
        scheduleDescription: "Tonight at 8pm",
        rollbackReason: null,
        errorMessage: null,
      },
      allApplicableForksTerminal: true,
    };

    const html = renderToStaticMarkup(
      <ReleaseDecisionPanel build={build} flowState={flowState} />,
    );

    expect(html).toContain("Community Sharing");
    expect(html).toContain("Release Readiness");
    expect(html).toContain("Deployment Timing");
    expect(html).toContain("PR #42 open");
    expect(html).toContain("Sandbox preview available");
    expect(html).toContain("Scheduled");
    expect(html).toContain("release-decision-panel");
  });
});
