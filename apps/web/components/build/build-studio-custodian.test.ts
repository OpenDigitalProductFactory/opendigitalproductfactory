import { describe, expect, it } from "vitest";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";
import {
  deriveBuildStudioWorkflowAction,
  type BuildStudioWorkflowAction,
} from "./build-studio-workflow-actions";
import { deriveBuildStudioCustodianPrompt } from "./build-studio-custodian";

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "build-row-1",
    buildId: "FB-9B19098C",
    title: "Build Studio operator review",
    description: "Make the Build Studio review path clear.",
    portfolioId: null,
    originatingBacklogItemId: "backlog-row-1",
    brief: {
      title: "Build Studio operator review",
      description: "Make the Build Studio review path clear.",
      portfolioContext: "Platform",
      targetRoles: ["operator"],
      inputs: ["feature build state"],
      dataNeeds: "FeatureBuild",
      acceptanceCriteria: ["The operator can finish review from Build Studio."],
    },
    plan: { happyPathState: normalizeHappyPathState(null) },
    phase: "review",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: "thread-1",
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date("2026-06-29T12:00:00Z"),
    updatedAt: new Date("2026-06-29T12:10:00Z"),
    draftApprovedAt: new Date("2026-06-29T12:01:00Z"),
    designDoc: {
      problemStatement: "The review path is unclear.",
      proposedApproach: "Show one next action.",
      reusePlan: "Reuse Build Studio actions.",
      acceptanceCriteria: ["The operator can finish review from Build Studio."],
    },
    designReview: { decision: "pass", summary: "Ready.", issues: [] },
    buildPlan: {
      fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Show custodian prompt." }],
      tasks: [{ title: "Add custodian prompt", testFirst: "Add tests", implement: "Render prompt", verify: "Run tests" }],
    },
    planReview: { decision: "pass", summary: "Ready.", issues: [] },
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
    scoutFindings: null,
    uxTestResults: null,
    uxVerificationStatus: "failed",
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

function progress(overrides: Partial<BuildProgressVisibility> = {}): BuildProgressVisibility {
  return {
    buildId: "FB-9B19098C",
    generatedAt: "2026-06-29T12:20:00.000Z",
    statusHeading: { operatorAction: "Run UX verification", failureAxis: null },
    progress: {
      primary: { source: "db-task-results", completed: 0, total: 0, observedAt: null },
      conflicts: [],
    },
    tasks: {
      completedTasks: 0,
      totalTasks: 0,
      source: { source: "db-task-results", completed: 0, total: 0, observedAt: null },
      tasks: [],
    },
    staleChatSnapshots: [],
    sandbox: null,
    dispatchHistory: [],
    verification: null,
    quietAgent: {
      quiet: true,
      minutesQuiet: 8,
      lastObservableSignalAt: "2026-06-29T12:12:00.000Z",
    },
    phaseRuns: [],
    ...overrides,
  };
}

describe("deriveBuildStudioCustodianPrompt", () => {
  it("surfaces proactive help when UX verification failed and the next click would feel inert", () => {
    const build = makeBuild({ uxVerificationStatus: "failed" });
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true });
    const prompt = deriveBuildStudioCustodianPrompt({ build, action, progressVisibility: progress() });

    expect(prompt).not.toBeNull();
    expect(prompt?.title).toBe("I can keep this review moving.");
    expect(prompt?.primaryAction).toBe("coworker");
    expect(prompt?.primaryLabel).toBe("Let AI Coworker handle it");
    expect(prompt?.whyNow).toContain("UX verification still needs clean evidence");
    expect(prompt?.coworkerPrompt).toContain("Act as the Build Studio custodian");
});

  it("stays quiet while an execution step is actively working", () => {
    const build = makeBuild({
      phase: "build",
      uxVerificationStatus: null,
      buildExecState: {
        step: "deps_installed",
        retryCount: 0,
        startedAt: "2026-06-29T12:12:00.000Z",
      },
    });
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true });
    const prompt = deriveBuildStudioCustodianPrompt({
      build,
      action,
      progressVisibility: progress({ quietAgent: { quiet: false, minutesQuiet: 1, lastObservableSignalAt: "2026-06-29T12:19:00.000Z" } }),
    });

    expect(prompt).toBeNull();
  });

  it("uses the in-place guided recovery as the primary action for failed plan review", () => {
    const build = makeBuild({
      phase: "plan",
      uxVerificationStatus: null,
      planReview: {
        decision: "fail",
        summary: "Needs a clearer verification plan.",
        issues: [{ severity: "critical", description: "Verification path is missing." }],
      },
    });
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true });
    const prompt = deriveBuildStudioCustodianPrompt({ build, action, progressVisibility: progress() });

    expect(action.kind).toBe("rerun-plan-review");
    expect(prompt?.primaryAction).toBe("workflow");
    expect(prompt?.primaryLabel).toBe("Try to fix");
    expect(prompt?.recommendedAction).toContain("guided fix");
  });

  it("offers evidence collection when the current gate is blocked by missing evidence", () => {
    const build = makeBuild();
    const action: BuildStudioWorkflowAction = {
      kind: "advance-phase",
      title: "Complete Review Evidence",
      message: "Review is still missing evidence or approvals.",
      primaryLabel: "Continue to Release",
      targetPhase: "ship",
      disabledReason: "Acceptance criteria not evaluated.",
      coworkerLabel: "Finish review with coworker",
      coworkerPrompt: "Evaluate each acceptance criterion.",
    };
    const prompt = deriveBuildStudioCustodianPrompt({ build, action, progressVisibility: progress() });

    expect(action.disabledReason).toBe("Acceptance criteria not evaluated.");
    expect(prompt?.statusLabel).toBe("Waiting on evidence");
    expect(prompt?.primaryAction).toBe("coworker");
    expect(prompt?.recommendedAction).toContain("collect the missing evidence");
  });
});
