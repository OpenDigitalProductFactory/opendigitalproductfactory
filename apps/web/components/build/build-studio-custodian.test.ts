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
import {
  deriveBuildStudioCustodianPrompt,
  hasNoReleasableDiff,
  isEmptyDiffHonestOutcome,
} from "./build-studio-custodian";

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
  // BI-C35F1FED — live repro FB-05946F96: "Start a new outcome" produced a build
  // awaiting approval; ten minutes later the quiet detector replaced the
  // approve-start CTA with "Build Studio may be stuck — review the current step
  // and resume it if needed", leaving no control that could start the work.
  it("stays silent while the build is waiting on the owner to approve the start", () => {
    const build = makeBuild({
      phase: "ideate",
      draftApprovedAt: null,
      // Approval is only managed for a build that came from a backlog row —
      // which is exactly what "Start a new outcome" creates.
      originator: {
        id: "backlog-row-1",
        itemId: "BI-5C3F3433",
        title: "Show the animals waiting longest for adoption",
        status: "in-progress",
        triageOutcome: "build",
        effortSize: "medium",
        proposedOutcome: null,
        activeBuildId: "build-row-1",
        resolution: null,
        abandonReason: null,
      },
    });
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true });
    expect(action.kind).toBe("approve-start");

    const prompt = deriveBuildStudioCustodianPrompt({
      build,
      action,
      // Well past the early-phase quiet threshold — the owner simply has not
      // clicked yet, which is not the platform going quiet.
      progressVisibility: progress({
        quietAgent: { quiet: true, minutesQuiet: 45, lastObservableSignalAt: "2026-06-29T11:35:00.000Z" },
      }),
    });

    expect(prompt).toBeNull();
  });

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

  it("resolves shared assertive proactivity for blocked or stalled custodian prompts", () => {
    const build = makeBuild({ uxVerificationStatus: "failed" });
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true });
    const prompt = deriveBuildStudioCustodianPrompt({ build, action, progressVisibility: progress() });

    expect(prompt?.proactivityPlan).toMatchObject({
      resolvedLevel: "assertive",
      policyId: "proactivity:build-studio-custodian:assertive",
      escalationTarget: "platform-operator",
      actionBoundary: "propose",
    });
    expect(prompt?.proactivityPlan.evidenceRefs).toEqual(
      expect.arrayContaining([
        { kind: "activity-family", id: "build-studio-custodian" },
        { kind: "status-signal", id: "blocked" },
        { kind: "route-context", id: "/build" },
      ]),
    );
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

  it("surfaces a 'gone quiet' nudge for a stalled ideate build (previously invisible)", () => {
    const build = makeBuild({
      phase: "ideate",
      uxVerificationStatus: null,
      designDoc: null,
      designReview: null,
      buildPlan: null,
      planReview: null,
      draftApprovedAt: null,
    });
    // A plain forward action with a null disabledReason — nothing else would
    // trip the custodian, so the only reason to surface is the early-phase quiet
    // bar. (blockedByEvidence keys off disabledReason != null, so it stays false.)
    const action: BuildStudioWorkflowAction = {
      kind: "advance-phase",
      title: "Continue",
      message: "Keep defining the feature.",
      primaryLabel: "Continue",
      targetPhase: "plan",
      disabledReason: null,
      coworkerLabel: "Continue with coworker",
      coworkerPrompt: "Keep defining the feature.",
    };

    // Quiet 8 minutes in ideate → now surfaces the honest "gone quiet" prompt.
    const quiet = deriveBuildStudioCustodianPrompt({ build, action, progressVisibility: progress() });
    expect(quiet).not.toBeNull();
    expect(quiet?.title).toBe("This build has gone quiet.");

    // Actively working (not quiet) in ideate → stays silent, no false nudge.
    const active = deriveBuildStudioCustodianPrompt({
      build,
      action,
      progressVisibility: progress({
        quietAgent: { quiet: false, minutesQuiet: 1, lastObservableSignalAt: "2026-06-29T12:19:00.000Z" },
      }),
    });
    expect(active).toBeNull();
  });

  it("shows a 'getting started' state (not 'Waiting on evidence') for a FRESH pre-brief ideate build", () => {
    const build = makeBuild({
      phase: "ideate",
      brief: null,
      uxVerificationStatus: null,
      designDoc: null,
      designReview: null,
      buildPlan: null,
      planReview: null,
      draftApprovedAt: null,
    });
    // disabledReason is set → this would normally hit the "Waiting on evidence"
    // branch; the pre-brief guard must intercept it.
    const action: BuildStudioWorkflowAction = {
      kind: "advance-phase",
      title: "Define the feature",
      message: "The feature brief is not ready yet.",
      primaryLabel: "Continue",
      targetPhase: "plan",
      disabledReason: "Feature brief not created yet.",
      coworkerLabel: "Continue with coworker",
      coworkerPrompt: "Draft the feature brief.",
    };
    // BI-0F7C855A: the soothing card is only honest while drafting is genuinely
    // young — below the early-phase quiet bar. (The old default fixture was 8
    // quiet minutes, which pinned the WRONG behavior: an indefinitely soothing
    // card that shadowed stall detection.)
    const prompt = deriveBuildStudioCustodianPrompt({
      build,
      action,
      progressVisibility: progress({
        quietAgent: { quiet: true, minutesQuiet: 2, lastObservableSignalAt: "2026-06-29T12:18:00.000Z" },
      }),
    });

    expect(prompt?.statusLabel).toBe("Getting started");
    expect(prompt?.title).toBe("Let's get this build started.");
    expect(prompt?.intent).toBe("info");
    expect(prompt?.whyNow).not.toContain("required evidence is missing");
  });

  it("replaces 'Nothing is wrong' with an honest stalled card once a pre-brief ideate build passes the quiet bar (BI-0F7C855A)", () => {
    const build = makeBuild({
      phase: "ideate",
      brief: null,
      uxVerificationStatus: null,
      designDoc: null,
      designReview: null,
      buildPlan: null,
      planReview: null,
      draftApprovedAt: null,
    });
    const action: BuildStudioWorkflowAction = {
      kind: "advance-phase",
      title: "Define the feature",
      message: "The feature brief is not ready yet.",
      primaryLabel: "Continue",
      targetPhase: "plan",
      disabledReason: "Feature brief not created yet.",
      coworkerLabel: "Continue with coworker",
      coworkerPrompt: "Draft the feature brief.",
    };
    // Default fixture: quiet for 8 minutes — past QUIET_EARLY_PHASE_THRESHOLD_MINUTES.
    const prompt = deriveBuildStudioCustodianPrompt({ build, action, progressVisibility: progress() });

    expect(prompt).not.toBeNull();
    expect(prompt?.statusLabel).toBe("Stalled");
    expect(prompt?.intent).toBe("warning");
    expect(prompt?.title).not.toBe("Let's get this build started.");
    // The dishonest copy must be gone: nothing IS wrong-claiming, no passive waiting.
    expect(prompt?.whyNow).not.toContain("Nothing is wrong");
    expect(prompt?.recommendedAction).not.toContain("let the coworker keep drafting");
    // The card must offer an actionable restart of the drafting turn.
    expect(prompt?.primaryAction).toBe("coworker");
    expect(prompt?.coworkerPrompt).toContain("Act as the Build Studio custodian");
    expect(prompt?.coworkerPrompt).toContain("Feature Brief");
  });

  it("surfaces a danger 'AI call failed' prompt (not 'Waiting on evidence') for a failed ideate inference (BI-F0005EB0)", () => {
    const build = makeBuild({
      phase: "ideate",
      uxVerificationStatus: null,
      // designDoc null => the advance gate would otherwise fire a disabledReason
      // and the custodian would say "Waiting on evidence".
      designDoc: null,
      designReview: null,
    });
    const progressVisibility = progress({
      quietAgent: { quiet: false, minutesQuiet: 0, lastObservableSignalAt: "2026-06-29T12:19:00.000Z" },
      inferenceFailure: { failed: true, kind: "connection", observedAt: "2026-06-29T12:19:00.000Z" },
    });
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true, progressVisibility });
    const prompt = deriveBuildStudioCustodianPrompt({ build, action, progressVisibility });

    expect(action.kind).toBe("retry-inference");
    expect(prompt).not.toBeNull();
    expect(prompt?.title).toBe("The AI call failed.");
    expect(prompt?.statusLabel).toBe("AI call failed");
    expect(prompt?.intent).toBe("danger");
    expect(prompt?.primaryAction).toBe("workflow");
    expect(prompt?.primaryLabel).toBe("Retry the AI call");
    // The raw provider error must never reach the user via the custodian.
    expect(JSON.stringify(prompt)).not.toMatch(/ECONNREFUSED|ConnectionRefused|API Error:/);
  });
});

// BI-A2F3FA9D — "abandoned" is a terminal escalate-to-human handoff. The
// custodian must never nudge on it (nothing to keep moving), even when the
// build looks quiet — mirroring the existing complete/ship suppression.
describe("deriveBuildStudioCustodianPrompt — terminal abandoned (BI-A2F3FA9D)", () => {
  it("returns null for an abandoned build even when quiet", () => {
    const build = makeBuild({
      phase: "abandoned",
      abandonReason: "Escalated to human after 2 self-repair round(s) at plan review (needs-human).",
      abandonedAt: new Date("2026-07-04T18:00:00Z"),
    });
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true });

    // progress() defaults to quiet=true, minutesQuiet=8 — the pre-fix path would
    // otherwise fall through to a "gone quiet" nudge.
    const prompt = deriveBuildStudioCustodianPrompt({ build, action, progressVisibility: progress() });

    expect(action.kind).toBe("escalated-to-human");
    expect(prompt).toBeNull();
  });
});

// BI-9C66860E — empty-diff honest status (EP-BS-UX-HARDENING invariant 5)
describe("empty-diff honest status (BI-9C66860E)", () => {
  it("hasNoReleasableDiff is true for null/whitespace patch+summary", () => {
    expect(hasNoReleasableDiff({ diffPatch: null, diffSummary: null })).toBe(true);
    expect(hasNoReleasableDiff({ diffPatch: "  ", diffSummary: "" })).toBe(true);
    expect(hasNoReleasableDiff({ diffPatch: "diff --git a/x b/x\n+", diffSummary: null })).toBe(false);
  });

  it("isEmptyDiffHonestOutcome is false mid-coding without quiet/terminal step", () => {
    const build = makeBuild({
      phase: "build",
      diffPatch: null,
      diffSummary: null,
      buildExecState: { step: "deps_installed", retryCount: 0, startedAt: "2026-06-29T12:12:00.000Z" },
    });
    expect(
      isEmptyDiffHonestOutcome({
        build,
        progressVisibility: progress({
          quietAgent: { quiet: false, minutesQuiet: 1, lastObservableSignalAt: "2026-06-29T12:19:00.000Z" },
        }),
      }),
    ).toBe(false);
  });

  it("surfaces a specific no-changes card instead of generic quiet when empty-diff + quiet", () => {
    const build = makeBuild({
      phase: "build",
      diffPatch: null,
      diffSummary: null,
      uxVerificationStatus: null,
      buildExecState: { step: "complete", retryCount: 0, startedAt: "2026-06-29T12:00:00.000Z" },
    });
    const action: BuildStudioWorkflowAction = {
      kind: "retry-build",
      title: "Retry",
      message: "Retry the build.",
      primaryLabel: "Retry build",
      targetPhase: null,
      disabledReason: null,
      coworkerLabel: "Retry with coworker",
      coworkerPrompt: "Retry the build.",
    };
    const prompt = deriveBuildStudioCustodianPrompt({
      build,
      action,
      progressVisibility: progress({
        quietAgent: { quiet: true, minutesQuiet: 17, lastObservableSignalAt: "2026-06-29T12:00:00.000Z" },
      }),
    });

    expect(prompt).not.toBeNull();
    expect(prompt?.title).toBe("This build finished without changes to deploy.");
    expect(prompt?.statusLabel).toBe("No changes to deploy");
    expect(prompt?.title).not.toBe("This build has gone quiet.");
    expect(prompt?.whyNow).toMatch(/no source changes|nothing to release/i);
    expect(prompt?.recommendedAction).toMatch(/Retry|refine/i);
    expect(prompt?.details.join(" ")).toMatch(/no releasable/i);
    expect(prompt?.primaryAction).toBe("workflow");
  });

  it("surfaces empty-diff honest card on ship phase (deploy refused, no releasable diff)", () => {
    const build = makeBuild({
      phase: "ship",
      diffPatch: "",
      diffSummary: null,
      uxVerificationStatus: "complete",
    });
    const action: BuildStudioWorkflowAction = {
      kind: "advance-phase",
      title: "Release",
      message: "Ship.",
      primaryLabel: "Deploy",
      targetPhase: "complete",
      disabledReason: null,
      coworkerLabel: "Ship with coworker",
      coworkerPrompt: "Ship the build.",
    };
    const prompt = deriveBuildStudioCustodianPrompt({
      build,
      action,
      progressVisibility: progress(),
    });
    expect(prompt?.statusLabel).toBe("No changes to deploy");
    expect(prompt?.title).toContain("without changes to deploy");
  });
});
