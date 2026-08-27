import { describe, expect, it } from "vitest";
import {
  deriveBuildStudioOperatorGuidance,
  deriveBuildStudioWorkflowAction,
  deriveWorkflowStageGuidance,
} from "./build-studio-workflow-actions";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "build-row-1",
    buildId: "FB-9B19098C",
    title: "Fix Build Studio header/content overlap in workflow view",
    description: "A real keeper bugfix for the governed Build Studio flow.",
    portfolioId: null,
    originatingBacklogItemId: "backlog-row-1",
    brief: {
      title: "Fix Build Studio header/content overlap in workflow view",
      description: "Keep the workflow workspace readable and usable with the coworker docked.",
      portfolioContext: "Platform",
      targetRoles: ["operator"],
      inputs: ["feature build state"],
      dataNeeds: "FeatureBuild, BacklogItem, workflow stage state",
      acceptanceCriteria: [
        "The workflow header no longer overlaps content.",
        "The operator can approve, implement, and verify from the Build Studio UI.",
      ],
    },
    plan: {
      happyPathState: normalizeHappyPathState({
        intake: {
          status: "ready",
          taxonomyNodeId: "TN-1",
          backlogItemId: "BI-5B839D74",
          epicId: "EP-BUILD-1",
          constrainedGoal: "Fix the Build Studio workflow blockers",
          failureReason: null,
        },
      }),
    },
    phase: "plan",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: "thread-1",
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date("2026-04-25T12:00:00Z"),
    updatedAt: new Date("2026-04-25T12:00:00Z"),
    draftApprovedAt: null,
    designDoc: {
      problemStatement: "Operators cannot complete the workflow from Build Studio.",
      proposedApproach: "Centralize stage action guidance and surface actions in the studio.",
      reusePlan: "Reuse existing phase gates and coworker shell events.",
      acceptanceCriteria: ["Approval and execution actions are visible in the studio."],
    },
    designReview: {
      decision: "pass",
      summary: "Looks good.",
      issues: [],
    },
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
    originator: {
      id: "backlog-row-1",
      itemId: "BI-5B839D74",
      title: "Fix Build Studio header/content overlap in workflow view",
      status: "open",
      triageOutcome: "build",
      effortSize: "small",
      proposedOutcome: null,
      activeBuildId: "build-row-1",
      resolution:
        "This is a real Build Studio workflow-layout defect, small enough for a safe governed end-to-end promotion test, and worth keeping once fixed.",
      abandonReason: null,
    },
    phaseHandoffs: [],
    happyPathState: normalizeHappyPathState({
      intake: {
        status: "ready",
        taxonomyNodeId: "TN-1",
        backlogItemId: "BI-5B839D74",
        epicId: "EP-BUILD-1",
        constrainedGoal: "Fix the Build Studio workflow blockers",
        failureReason: null,
      },
    }),
    ...overrides,
  };
}

// A review-phase non-UI build (UX verification skipped) whose whole-repo
// verification reported out-of-scope test noise (typecheck passed, 88 failures
// elsewhere). `affectedTests` controls whether any failure is in the build's
// own changed surface. Used to prove the action layer mirrors checkPhaseGate:
// out-of-scope noise is advisory; an in-scope failure still blocks.
function reviewBuildWithScopedSurface(affectedTests: string[]): {
  build: FeatureBuildRow;
  progressVisibility: BuildProgressVisibility;
} {
  const build = makeBuild({
    phase: "review",
    draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
    uxVerificationStatus: "skipped",
    uxTestResults: [],
    buildPlan: {
      fileStructure: [{ path: "apps/web/lib/utils/string-helpers.ts", action: "create", purpose: "truncateMiddle helper." }],
      tasks: [{ title: "Add truncateMiddle", testFirst: "write test", implement: "write helper", verify: "run tests" }],
    },
    planReview: { decision: "pass", summary: "Ready.", issues: [] },
    verificationOut: {
      testsPassed: 50780,
      testsFailed: 88,
      typecheckPassed: true,
      failureAxis: "test-failure",
      fullOutput: "88 unrelated failures elsewhere in the repo",
      timestamp: "2026-06-19T16:46:14Z",
    } as unknown as FeatureBuildRow["verificationOut"],
    acceptanceMet: [
      { criterion: "returns length 7", met: true },
      { criterion: "returns original when short", met: true },
    ] as unknown as FeatureBuildRow["acceptanceMet"],
  });
  const progressVisibility = {
    buildId: "FB-9B19098C",
    generatedAt: "2026-06-19T16:58:00.000Z",
    statusHeading: { operatorAction: "Run scoped verification for this build", failureAxis: "test-failure" },
    progress: { primary: { source: "db-task-results", completed: 1, total: 1, observedAt: "2026-06-19T16:46:14Z" }, conflicts: [] },
    tasks: {
      completedTasks: 1,
      totalTasks: 1,
      source: { source: "db-task-results", completed: 1, total: 1, observedAt: "2026-06-19T16:46:14Z" },
      tasks: [{ taskIndex: -1, title: "Full verification: tests + typecheck", specialist: "qa-engineer", outcome: "DONE_WITH_CONCERNS", durationMs: 333383, summary: "ran the full suite", files: [] }],
    },
    staleChatSnapshots: [],
    sandbox: null,
    dispatchHistory: [],
    verification: {
      source: "verification",
      observedAt: "2026-06-19T16:46:14Z",
      buildScoped: { typecheckPassed: true, testsPassed: 50780, testsFailed: 88, failureAxis: "test-failure", affectedFiles: ["apps/web/lib/utils/string-helpers.ts"], affectedTests },
      globalHealth: { testsFailed: 88, outputExcerpt: null },
    },
    quietAgent: { quiet: true, minutesQuiet: 5, lastObservableSignalAt: "2026-06-19T16:46:14Z" },
    phaseRuns: [],
  } satisfies BuildProgressVisibility;
  return { build, progressVisibility };
}

describe("deriveBuildStudioWorkflowAction", () => {
  it("surfaces start approval even when a linked backlog build has already reached planning", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild(),
      governedBacklogEnabled: false,
    });

    expect(action.kind).toBe("approve-start");
    expect(action.title).toContain("Approval");
    expect(action.primaryLabel).toBe("Record Approve Start");
    expect(action.message).toContain("before planning");
  });

  it("surfaces an Advance to Plan button when ideate review has passed and intake is ready (BI-77A1973C)", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "ideate",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("advance-phase");
    expect(action.primaryLabel).toBe("Advance to Plan");
    expect(action.targetPhase).toBe("plan");
    expect(action.disabledReason).toBeNull();
  });

  // BI-04B112CA / BI-97F7F599 — live repro FB-41EA43C5: the design passed review
  // and the size gate said decompose-required, and the owner was still offered
  // "Advance to Plan" — the one action the platform had already decided to block.
  it("offers the split instead of Advance to Plan when the size gate says the design is too big", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "ideate",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        designReview: {
          decision: "pass",
          issues: [],
          sizeAssessment: { decision: "decompose-required" },
        } as unknown as FeatureBuildRow["designReview"],
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("decompose-now");
    expect(action.primaryLabel).toBe("Split into smaller builds");
    expect(action.targetPhase).toBeNull();
    expect(action.disabledReason).toBeNull();
    // Plain words, not a size label the owner has to decode.
    expect(action.title).toMatch(/too big for one build/i);
  });

  it("still advances to Plan when the design is the right size", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "ideate",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        designReview: {
          decision: "pass",
          issues: [],
          sizeAssessment: { decision: "ok" },
        } as unknown as FeatureBuildRow["designReview"],
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("advance-phase");
    expect(action.primaryLabel).toBe("Advance to Plan");
  });

  it("disables Advance to Plan with the gate reason when ideate evidence is incomplete", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "ideate",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        designDoc: null,
        designReview: null,
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("advance-phase");
    expect(action.targetPhase).toBe("plan");
    expect(action.disabledReason).not.toBeNull();
    expect(action.disabledReason).toMatch(/design document|design review/i);
  });

  it("surfaces implementation when planning is ready to advance", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Surface workflow actions." }],
          tasks: [{ title: "Add workflow actions", testFirst: "Add failing tests.", implement: "Render the actions.", verify: "Run the build checks." }],
        },
        planReview: {
          decision: "pass",
          summary: "Ready to implement.",
          issues: [],
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("advance-phase");
    expect(action.primaryLabel).toBe("Start Implementation");
    expect(action.targetPhase).toBe("build");
    expect(action.disabledReason).toBeNull();
    expect(action.coworkerPrompt).toContain('saveBuildEvidence field buildPlan');
    expect(action.coworkerPrompt).toContain("reviewBuildPlan");
  });

  it("turns an oscillating top-level plan review into a decompose-now action", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        planReview: {
          decision: "fail",
          summary: "Scope is still unstable.",
          issues: [{ severity: "important", description: "Plan is too broad." }],
          iteration: {
            round: 3,
            prior: { issueCount: 8, addressed: 2, persisted: 5, newlySurfaced: 3 },
            oscillating: true,
          },
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("decompose-now");
    expect(action.primaryLabel).toBe("Decompose now");
    expect(action.disabledReason).toBeNull();
    expect(action.message).toContain("Plan review is oscillating");
  });

  it("shows disabled decompose-now when an oscillating top-level build has no design doc", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        designDoc: null,
        planReview: {
          decision: "fail",
          summary: "Scope is still unstable.",
          issues: [],
          iteration: {
            round: 3,
            prior: { issueCount: 8, addressed: 2, persisted: 5, newlySurfaced: 3 },
            oscillating: true,
          },
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("decompose-now");
    expect(action.disabledReason).toBe("Need a design doc first.");
  });

  it("routes oscillating child builds to parent amendment instead of recursive decomposition", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        parentEpicId: "epic-row-1",
        planReview: {
          decision: "fail",
          summary: "Scope is still unstable.",
          issues: [],
          iteration: {
            round: 3,
            prior: { issueCount: 8, addressed: 2, persisted: 5, newlySurfaced: 3 },
            oscillating: true,
          },
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("amend-parent-design");
    expect(action.primaryLabel).toBe("Amend parent design");
    expect(action.coworkerPrompt).toContain("parent design");
  });

  it("offers a re-run-plan-review action when a non-oscillating plan review failed (BI-E1CB0522)", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/lib/build/ollama-url.ts", action: "modify", purpose: "Add a clarifying comment." }],
          tasks: [{ title: "Add comment", testFirst: "n/a for a comment", implement: "Add the comment", verify: "Read the file" }],
        },
        planReview: {
          decision: "fail",
          summary: "Missing test-first steps.",
          issues: [{ severity: "critical", description: "Task lacks a test-first step." }],
          iteration: { round: 1 },
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("rerun-plan-review");
    expect(action.primaryLabel).toBe("Try to fix");
    expect(action.coworkerLabel).toBe("Something looks off");
    expect(action.targetPhase).toBeNull();
    expect(action.disabledReason).toBeNull();
    expect(action.message).toContain("Next: click Try to fix");
    expect(action.coworkerPrompt).not.toContain("saveBuildEvidence");
    expect(action.coworkerPrompt).not.toContain("reviewBuildPlan");
  });

  it("derives a single operator status and next action for plan-review recovery", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/lib/build/ollama-url.ts", action: "modify", purpose: "Add a clarifying comment." }],
          tasks: [{ title: "Add comment", testFirst: "n/a for a comment", implement: "Add the comment", verify: "Read the file" }],
        },
        planReview: {
          decision: "fail",
          summary: "Missing test-first steps.",
          issues: [{ severity: "critical", description: "Task lacks a test-first step." }],
          iteration: { round: 1 },
        },
      }),
      governedBacklogEnabled: true,
    });

    const guidance = deriveBuildStudioOperatorGuidance(action);
    expect(guidance.status.label).toBe("Waiting on you");
    expect(guidance.nextLabel).toBe("Try to fix");
    expect(guidance.nextSentence).toBe("Next: try to fix the plan review here.");
    expect(guidance.guidedRecovery).toBe(true);
  });

  it("labels an active build execution as Working even before the next gate unlocks", () => {
    const build = makeBuild({
      phase: "build",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      buildPlan: {
        fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Surface workflow actions." }],
        tasks: [{ title: "Add workflow actions", testFirst: "Add failing tests.", implement: "Render the actions.", verify: "Run the build checks." }],
      },
      planReview: { decision: "pass", summary: "Ready.", issues: [] },
      buildExecState: {
        step: "deps_installed",
        retryCount: 0,
        startedAt: "2026-04-25T13:10:00Z",
      },
    });
    const action = deriveBuildStudioWorkflowAction({
      build,
      governedBacklogEnabled: true,
    });

    const guidance = deriveBuildStudioOperatorGuidance(action, build);
    expect(guidance.status.label).toBe("Working");
    expect(guidance.nextSentence).toContain("Next:");
  });

  it("does not offer re-run-plan-review when the plan review has not run yet", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/lib/build/ollama-url.ts", action: "modify", purpose: "Add a clarifying comment." }],
          tasks: [{ title: "Add comment", testFirst: "n/a", implement: "Add the comment", verify: "Read the file" }],
        },
        planReview: null,
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("advance-phase");
  });

  it("surfaces verification once implementation evidence is ready", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Surface workflow actions." }],
          tasks: [{ title: "Add workflow actions", testFirst: "Add failing tests.", implement: "Render the actions.", verify: "Run the build checks." }],
        },
        planReview: {
          decision: "pass",
          summary: "Ready to implement.",
          issues: [],
        },
        verificationOut: {
          testsPassed: 3,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "all green",
          timestamp: "2026-04-25T13:20:00Z",
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("advance-phase");
    expect(action.primaryLabel).toBe("Run Verification Review");
    expect(action.targetPhase).toBe("review");
  });

  it("surfaces implementation recovery during build when task results are flagged", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix layout overlap." }],
          tasks: [{ title: "Fix layout overlap", testFirst: "Reproduce overlap", implement: "Refactor layout", verify: "Run checks" }],
        },
        planReview: {
          decision: "pass",
          summary: "Ready to implement.",
          issues: [],
        },
        taskResults: {
          completedTasks: 0,
          totalTasks: 1,
          tasks: [{ title: "Fix layout overlap", specialist: "frontend-engineer", outcome: "DONE_WITH_CONCERNS" }],
        } as unknown as FeatureBuildRow["taskResults"],
        verificationOut: {
          testsPassed: 0,
          testsFailed: 0,
          typecheckPassed: false,
          fullOutput: "container not running",
          timestamp: "2026-04-25T13:20:00Z",
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("resume-implementation");
    expect(action.primaryLabel).toBe("Try to fix");
    // BI-FD796419 / Band 4 — plain copy guides the operator to the in-place
    // recovery action without surfacing sandbox/runtime jargon.
    expect(action.message).toContain("Next: click Try to fix");
    expect(action.message).not.toContain("healthy sandbox");
  });

  it("does not force Resume Implementation on a review build whose scoped surface is clean despite out-of-scope test noise (BI-2F10D6D3 follow-up)", () => {
    // The truncateMiddle strand's second-order blocker: review-verification was
    // skipped (non-UI), typecheck passed, and the 88 failures are all outside
    // the changed surface (affectedTests === []). The action layer must mirror
    // checkPhaseGate (typecheck-only) and advance instead of looping Resume.
    const { build, progressVisibility } = reviewBuildWithScopedSurface([]);
    const action = deriveBuildStudioWorkflowAction({
      build,
      governedBacklogEnabled: true,
      progressVisibility,
    });

    expect(action.kind).not.toBe("resume-implementation");
    expect(action.primaryLabel).not.toBe("Try to fix");
    expect(action.kind).toBe("advance-phase");
    expect(action.primaryLabel).toBe("Continue to Release");
    expect(action.targetPhase).toBe("ship");
    expect(action.disabledReason).toBeNull();
  });

  it("still forces Resume Implementation when a failing test IS in the build's changed surface", () => {
    const { build, progressVisibility } = reviewBuildWithScopedSurface([
      "apps/web/lib/utils/string-helpers.test.ts",
    ]);
    const action = deriveBuildStudioWorkflowAction({
      build,
      governedBacklogEnabled: true,
      progressVisibility,
    });

    expect(action.kind).toBe("resume-implementation");
    expect(action.primaryLabel).toBe("Try to fix");
  });

  it("names the resume action and failure axis for blocked usage-limit tasks", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        taskResults: {
          completedTasks: 0,
          totalTasks: 3,
          tasks: [
            { title: "Add dispatch telemetry", specialist: "backend-engineer", outcome: "BLOCKED", artifactSummary: "ERROR: You've hit your usage limit." },
            { title: "Add sandbox card", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "ERROR: You've hit your usage limit." },
            { title: "Add verification card", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "ERROR: You've hit your usage limit." },
          ],
          timestamp: "2026-05-18T12:00:00.000Z",
        } as unknown as FeatureBuildRow["taskResults"],
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("resume-implementation");
    expect(action.title).toBe("3 tasks need another pass");
    expect(action.failureAxis).toBe("usage-limit");
    expect(action.message).toContain("Next: click Try to fix");
    expect(action.message).not.toContain("usage-limit");
    expect(action.resumeMode?.mode).toBe("reset-blocked");
  });

  it("uses the progress projection failure axis when task summaries are not diagnostic", () => {
    const progressVisibility = {
      buildId: "FB-9B19098C",
      generatedAt: "2026-05-19T19:45:00.000Z",
      statusHeading: {
        operatorAction: "Click Resume to re-execute 2 blocked tasks",
        failureAxis: "usage-limit",
      },
      progress: {
        primary: {
          source: "db-task-results",
          completed: 7,
          total: 9,
          observedAt: "2026-05-19T17:23:40.189Z",
        },
        conflicts: [],
      },
      tasks: {
        completedTasks: 7,
        totalTasks: 9,
        source: {
          source: "db-task-results",
          completed: 7,
          total: 9,
          observedAt: "2026-05-19T17:23:40.189Z",
        },
        tasks: [
          {
            taskIndex: 0,
            title: "Update provider page",
            specialist: "frontend-engineer",
            outcome: "BLOCKED",
            durationMs: null,
            summary: "Task completed with no output.",
            files: [],
          },
          {
            taskIndex: 1,
            title: "Run verification",
            specialist: "qa-engineer",
            outcome: "BLOCKED",
            durationMs: null,
            summary: "Task completed with no output.",
            files: [],
          },
        ],
      },
      staleChatSnapshots: [],
      sandbox: null,
      dispatchHistory: [
        {
          id: "attempt-1",
          buildId: "FB-9B19098C",
          taskTitle: "Run verification",
          specialist: "qa-engineer",
          providerId: "chatgpt",
          model: "gpt-5.3-codex",
          attemptNumber: 1,
          startedAt: "2026-05-19T06:04:52.138Z",
          completedAt: "2026-05-19T06:04:53.864Z",
          durationMs: 1726,
          exitCode: 1,
          success: false,
          failureAxis: "usage-limit",
          stdoutExcerpt: "ERROR: You've hit your usage limit.",
          stderrExcerpt: null,
          rootCauseSummary: "ERROR: You've hit your usage limit.",
          rootCauseHash: "abc123abc123abcd",
        },
      ],
      verification: null,
      quietAgent: {
        quiet: true,
        minutesQuiet: 135,
        lastObservableSignalAt: "2026-05-19T17:23:40.189Z",
      },
      phaseRuns: [],
    } satisfies BuildProgressVisibility;

    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        taskResults: {
          completedTasks: 7,
          totalTasks: 9,
          tasks: [
            { title: "Update provider page", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "Task completed with no output." },
            { title: "Run verification", specialist: "qa-engineer", outcome: "BLOCKED", artifactSummary: "Task completed with no output." },
          ],
          timestamp: "2026-05-19T17:23:40.189Z",
        } as unknown as FeatureBuildRow["taskResults"],
      }),
      governedBacklogEnabled: true,
      progressVisibility,
    });

    expect(action.kind).toBe("resume-implementation");
    expect(action.title).toBe("2 tasks need another pass");
    expect(action.failureAxis).toBe("usage-limit");
    expect(action.message).toContain("Next: click Try to fix");
    expect(action.message).not.toContain("usage-limit");
  });

  it("separates out-of-scope verification noise from implementation recovery", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "review",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        taskResults: {
          completedTasks: 2,
          totalTasks: 2,
          tasks: [
            { title: "Add scoped verification", specialist: "backend-engineer", outcome: "DONE" },
            { title: "Add cards", specialist: "frontend-engineer", outcome: "DONE" },
          ],
          timestamp: "2026-05-18T12:00:00.000Z",
        } as unknown as FeatureBuildRow["taskResults"],
        verificationOut: {
          typecheckPassed: false,
          testsPassed: 0,
          testsFailed: 192,
          failureAxis: "out-of-scope-noise",
          fullOutput: "FAIL apps/web/lib/mcp-tools-save-build-evidence.test.ts",
          timestamp: "2026-05-18T12:05:00.000Z",
        } as unknown as FeatureBuildRow["verificationOut"],
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("resume-implementation");
    expect(action.title).toBe("Review workspace noise before retrying this build");
    expect(action.failureAxis).toBe("out-of-scope-noise");
    expect(action.resumeMode?.mode).toBe("rerun-verification");
    // BI-FD796419 / Band 4 — the operator-facing message leads with plain
    // language (what it means + what to do), not the "Failure axis:" jargon;
    // the technical axis is kept only on structured fields for engineer view.
    expect(action.message).not.toMatch(/^Failure axis/);
    expect(action.message).toContain("Next: click Try to fix");
    expect(action.message).not.toContain("out-of-scope-noise");
  });

  it("surfaces implementation recovery in review when review only contains failed execution evidence", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "review",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        taskResults: {
          completedTasks: 0,
          totalTasks: 2,
          tasks: [
            { title: "Fix layout overlap", specialist: "frontend-engineer", outcome: "DONE_WITH_CONCERNS" },
            { title: "Run verification", specialist: "qa-engineer", outcome: "DONE_WITH_CONCERNS" },
          ],
        } as unknown as FeatureBuildRow["taskResults"],
        verificationOut: {
          testsPassed: 0,
          testsFailed: 1,
          typecheckPassed: false,
          fullOutput: "typecheck failed",
          timestamp: "2026-04-25T13:20:00Z",
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("resume-implementation");
    expect(action.primaryLabel).toBe("Try to fix");
    expect(action.coworkerLabel).toBe("Recover with coworker");
  });

  it("surfaces a manual UX verification action when review never received UX evidence", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "review",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        verificationOut: {
          testsPassed: 0,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "typecheck clean",
          timestamp: "2026-04-25T13:20:00Z",
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("run-review-verification");
    expect(action.primaryLabel).toBe("Run UX Verification");
    expect(action.disabledReason).toBeNull();
    expect(action.coworkerLabel).toBe("Finish acceptance review");
  });

  it("surfaces the ship transition when review evidence is complete", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "review",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix layout overlap." }],
          tasks: [{ title: "Fix layout overlap", testFirst: "Reproduce overlap", implement: "Refactor layout", verify: "Run checks" }],
        },
        verificationOut: {
          testsPassed: 0,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "typecheck clean",
          timestamp: "2026-04-25T13:20:00Z",
        },
        acceptanceMet: [
          { criterion: "The workflow header no longer overlaps content.", met: true, evidence: "Header wraps cleanly." },
          { criterion: "The operator can approve, implement, and verify from the Build Studio UI.", met: true, evidence: "Studio controls present." },
        ],
        uxVerificationStatus: "complete",
        uxTestResults: [
          { step: "Header does not overlap content", passed: true, screenshotUrl: "/evidence/header.png", error: null },
        ],
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("advance-phase");
    expect(action.primaryLabel).toBe("Continue to Release");
    expect(action.targetPhase).toBe("ship");
    expect(action.disabledReason).toBeNull();
  });

  it("surfaces a direct acceptance action when UX evidence is complete and only acceptance is missing", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "review",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix layout overlap." }],
          tasks: [{ title: "Fix layout overlap", testFirst: "Reproduce overlap", implement: "Refactor layout", verify: "Run checks" }],
        },
        verificationOut: {
          testsPassed: 1,
          testsFailed: 7,
          typecheckPassed: true,
          fullOutput: "legacy suite drift",
          timestamp: "2026-04-25T13:20:00Z",
        },
        acceptanceMet: null,
        uxVerificationStatus: "complete",
        uxTestResults: [
          { step: "Header does not overlap content", passed: true, screenshotUrl: "/evidence/header.png", error: null },
        ],
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("record-acceptance");
    expect(action.primaryLabel).toBe("Record Acceptance");
    expect(action.disabledReason).toBeNull();
    expect(action.coworkerLabel).toBe("Summarize review with coworker");
  });

  it("keeps the review transition visible when evidence is still missing", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "review",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        verificationOut: {
          testsPassed: 0,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "typecheck clean",
          timestamp: "2026-04-25T13:20:00Z",
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("run-review-verification");
    expect(action.primaryLabel).toBe("Run UX Verification");
    expect(action.disabledReason).toBeNull();
    expect(action.coworkerLabel).toBe("Finish acceptance review");
  });
});

describe("deriveWorkflowStageGuidance", () => {
  it("shows approval guidance on the ideate node for linked backlog builds without recorded approval", () => {
    const guidance = deriveWorkflowStageGuidance({
      build: makeBuild(),
      phase: "ideate",
      workflowLabel: "In Progress",
      governedBacklogEnabled: false,
    });

    expect(guidance.nextApproval).toContain("Approve Start");
    expect(guidance.title).toContain("Approval");
  });

  it("shows recovery guidance when review needs implementation recovery", () => {
    const guidance = deriveWorkflowStageGuidance({
      build: makeBuild({
        phase: "review",
        taskResults: {
          completedTasks: 0,
          totalTasks: 1,
          tasks: [{ title: "Fix layout overlap", specialist: "frontend-engineer", outcome: "DONE_WITH_CONCERNS" }],
        } as unknown as FeatureBuildRow["taskResults"],
        verificationOut: {
          testsPassed: 0,
          testsFailed: 1,
          typecheckPassed: false,
          fullOutput: "container not running",
          timestamp: "2026-04-25T13:20:00Z",
        },
      }),
      phase: "review",
      workflowLabel: "Review",
      governedBacklogEnabled: true,
    });

    expect(guidance.title).toBe("1 task needs another pass");
    expect(guidance.nextApproval).toContain("Try to fix");
  });

  it("exposes specific recovery heading details in stage guidance", () => {
    const guidance = deriveWorkflowStageGuidance({
      build: makeBuild({
        phase: "build",
        taskResults: {
          completedTasks: 0,
          totalTasks: 3,
          tasks: [
            { title: "Task 1", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "ERROR: You've hit your usage limit." },
            { title: "Task 2", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "ERROR: You've hit your usage limit." },
            { title: "Task 3", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "ERROR: You've hit your usage limit." },
          ],
        } as unknown as FeatureBuildRow["taskResults"],
      }),
      phase: "build",
      workflowLabel: "Build",
      governedBacklogEnabled: true,
    });

    expect(guidance.title).toBe("3 tasks need another pass");
    expect(guidance.workflowAction.failureAxis).toBe("usage-limit");
    expect(guidance.workflowAction.message).toContain("Next: click Try to fix");
    expect(guidance.workflowAction.message).not.toContain("usage-limit");
  });

  it("shows release guidance on the review node when review evidence is complete", () => {
    const guidance = deriveWorkflowStageGuidance({
      build: makeBuild({
        phase: "review",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        buildPlan: {
          fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix layout overlap." }],
          tasks: [{ title: "Fix layout overlap", testFirst: "Reproduce overlap", implement: "Refactor layout", verify: "Run checks" }],
        },
        verificationOut: {
          testsPassed: 0,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "typecheck clean",
          timestamp: "2026-04-25T13:20:00Z",
        },
        acceptanceMet: [
          { criterion: "The workflow header no longer overlaps content.", met: true, evidence: "Header wraps cleanly." },
        ],
        uxVerificationStatus: "complete",
        uxTestResults: [{ step: "Header does not overlap", passed: true, screenshotUrl: null, error: null }],
      }),
      phase: "review",
      workflowLabel: "Ready to Release",
      governedBacklogEnabled: true,
    });

    expect(guidance.title).toBe("Ready for Release Decisions");
    expect(guidance.nextApproval).toContain("Continue to release decisions");
  });

  it("keeps the review node actionable when UX verification still needs to run", () => {
    const guidance = deriveWorkflowStageGuidance({
      build: makeBuild({
        phase: "review",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        verificationOut: {
          testsPassed: 0,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "typecheck clean",
          timestamp: "2026-04-25T13:20:00Z",
        },
      }),
      phase: "review",
      workflowLabel: "Review",
      governedBacklogEnabled: true,
    });

    expect(guidance.workflowAction.kind).toBe("run-review-verification");
    expect(guidance.nextApproval).toContain("sandbox evidence");
  });

  it("matches the top-card failureAxis when projection data is provided (single-narrator invariant)", () => {
    const build = makeBuild({
      phase: "build",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      taskResults: {
        completedTasks: 7,
        totalTasks: 9,
        tasks: [
          { title: "Update provider page", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "Task completed with no output." },
          { title: "Run verification", specialist: "qa-engineer", outcome: "BLOCKED", artifactSummary: "Task completed with no output." },
        ],
        timestamp: "2026-05-19T17:23:40.189Z",
      } as unknown as FeatureBuildRow["taskResults"],
    });
    const progressVisibility = {
      buildId: "FB-9B19098C",
      generatedAt: "2026-05-19T19:45:00.000Z",
      statusHeading: {
        operatorAction: "Click Resume to re-execute 2 blocked tasks",
        failureAxis: "usage-limit",
      },
      progress: {
        primary: {
          source: "db-task-results",
          completed: 7,
          total: 9,
          observedAt: "2026-05-19T17:23:40.189Z",
        },
        conflicts: [],
      },
      tasks: {
        completedTasks: 7,
        totalTasks: 9,
        source: {
          source: "db-task-results",
          completed: 7,
          total: 9,
          observedAt: "2026-05-19T17:23:40.189Z",
        },
        tasks: [
          {
            taskIndex: 0,
            title: "Update provider page",
            specialist: "frontend-engineer",
            outcome: "BLOCKED",
            durationMs: null,
            summary: "Task completed with no output.",
            files: [],
          },
          {
            taskIndex: 1,
            title: "Run verification",
            specialist: "qa-engineer",
            outcome: "BLOCKED",
            durationMs: null,
            summary: "Task completed with no output.",
            files: [],
          },
        ],
      },
      staleChatSnapshots: [],
      sandbox: null,
      dispatchHistory: [],
      verification: null,
      quietAgent: {
        quiet: true,
        minutesQuiet: 135,
        lastObservableSignalAt: "2026-05-19T17:23:40.189Z",
      },
      phaseRuns: [],
    } satisfies BuildProgressVisibility;

    const topCardAction = deriveBuildStudioWorkflowAction({
      build,
      governedBacklogEnabled: true,
      progressVisibility,
    });
    const guidance = deriveWorkflowStageGuidance({
      build,
      phase: "build",
      workflowLabel: "Build",
      governedBacklogEnabled: true,
      progressVisibility,
    });

    expect(guidance.workflowAction.failureAxis).toBe("usage-limit");
    expect(guidance.workflowAction.failureAxis).toBe(topCardAction.failureAxis);
    expect(guidance.title).toBe(topCardAction.title);
    expect(guidance.title).toBe("2 tasks need another pass");
  });

  // FB-78E967D4 — Reset Build affordance for contradictory pipeline state.
  it("surfaces Reset Build when buildExecState has lingering error on a non-failed step (FB-F0476EF3 shape)", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        // No task results yet — the pipeline never produced any. This is the
        // canonical FB-F0476EF3 shape: the original run threw inside
        // stepGenerateCode/deps_installed, and a subsequent pipeline pass
        // short-circuited past the failed step to step="complete" while the
        // error/failedAt breadcrumbs from the failed run lingered.
        taskResults: null,
        verificationOut: null,
        buildExecState: {
          step: "complete",
          retryCount: 0,
          startedAt: "2026-05-20T06:30:00.000Z",
          completedAt: "2026-05-20T06:38:23.171Z",
          failedAt: "deps_installed",
          error: "brief.targetRoles undefined",
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("reset-build");
    expect(action.primaryLabel).toBe("Reset Build");
    expect(action.disabledReason).toBeNull();
    expect(action.title).toContain("Reset");
    expect(action.message).toMatch(/contradictory|checkpoint/i);
  });

  // Pipeline stalled before setting first step (e.g. portal restart killed
  // autoExecuteBuild before stepCreateSandbox could write step="sandbox_created").
  // FB-7A21E1F6 shape: buildExecState has sourceCurrency and metadata but no step.
  it("surfaces Reset Build when buildExecState exists but has no step (stalled at pending)", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        taskResults: null,
        verificationOut: null,
        buildExecState: {
          // No `step` field — pipeline was killed before writing its first checkpoint.
          // Casting to satisfy the type; the runtime JSONB can be missing this key.
          sourceCurrency: {
            dirty: false,
            branch: "build/FB-7A21E1F6",
            status: "current",
            aheadBy: 0,
            headSha: "41c46682a3f9df4b4963cb749842765f8371f27f",
            behindBy: 0,
            checkedAt: "2026-05-20T02:20:08.893Z",
          } as unknown as never,
        } as unknown as FeatureBuildRow["buildExecState"],
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("reset-build");
    expect(action.primaryLabel).toBe("Reset Build");
    expect(action.disabledReason).toBeNull();
    expect(action.message).toMatch(/stalled|interrupted/i);
  });

  it("surfaces the real error breadcrumb on a stalled no-step build instead of guessing portal restart", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        taskResults: null,
        verificationOut: null,
        buildExecState: {
          // No `step`, but the pipeline left a real error breadcrumb — the UX
          // must surface THIS, not fabricate "portal restart".
          error:
            "Build build phase stalled (heartbeat_timeout) — no heartbeat within 1800s (codegen context overflow)",
          sourceCurrency: {
            dirty: false,
            branch: "build/FB-REALREASON",
            status: "current",
            aheadBy: 0,
            headSha: "41c46682a3f9df4b4963cb749842765f8371f27f",
            behindBy: 0,
            checkedAt: "2026-05-20T02:20:08.893Z",
          } as unknown as never,
        } as unknown as FeatureBuildRow["buildExecState"],
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("reset-build");
    expect(action.primaryLabel).toBe("Reset Build");
    expect(action.message).toContain("heartbeat_timeout");
    expect(action.message).not.toMatch(/portal restart/i);
  });

  it("does NOT surface Reset Build for a legitimate step=failed state — that path uses Retry Sandbox Launch", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        taskResults: null,
        verificationOut: null,
        buildExecState: {
          step: "failed",
          retryCount: 2,
          startedAt: "2026-05-20T06:30:00.000Z",
          failedAt: "sandbox_created",
          error: "docker run exited 125",
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("retry-build");
    expect(action.primaryLabel).toBe("Retry Sandbox Launch");
  });

  it("does NOT surface Reset Build when the pipeline checkpoint is healthy (no error breadcrumb)", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "build",
        draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        taskResults: null,
        verificationOut: null,
        buildExecState: {
          step: "deps_installed",
          retryCount: 0,
          startedAt: "2026-05-20T06:30:00.000Z",
        },
      }),
      governedBacklogEnabled: true,
    });

    expect(action.kind).not.toBe("reset-build");
  });

  it("falls back to build-row derivation when projection is absent (graceful degradation)", () => {
    const build = makeBuild({
      phase: "build",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      taskResults: {
        completedTasks: 0,
        totalTasks: 1,
        tasks: [
          { title: "Update provider page", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "ERROR: You've hit your usage limit." },
        ],
        timestamp: "2026-05-19T17:23:40.189Z",
      } as unknown as FeatureBuildRow["taskResults"],
    });

    const guidance = deriveWorkflowStageGuidance({
      build,
      phase: "build",
      workflowLabel: "Build",
      governedBacklogEnabled: true,
      progressVisibility: null,
    });

    expect(guidance.workflowAction.kind).toBe("resume-implementation");
    expect(guidance.workflowAction.failureAxis).toBe("usage-limit");
  });
});

// BI-A2F3FA9D — an escalated-to-human build (phase="abandoned") is terminal:
// WIP freed, originating BI parked as "deferred". The old code had no branch, so
// it fell through to "review-only" and rendered a stale "Working" status. These
// lock in the terminal handoff surface: escalated action + danger status + the
// parked-BI link, and prove it is NOT review-only/"working".
describe("deriveBuildStudioWorkflowAction — escalate-to-human (BI-A2F3FA9D)", () => {
  function abandonedBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
    return makeBuild({
      phase: "abandoned",
      abandonReason:
        "Escalated to human after 2 self-repair round(s) at plan review (needs-human); tracked as PIR-123. Freed a Build Studio WIP slot. (BI-3E0EE3BA)",
      abandonedAt: new Date("2026-07-04T18:00:00Z"),
      ...overrides,
    });
  }

  it("returns the escalated-to-human action, not review-only", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: abandonedBuild(),
      governedBacklogEnabled: true,
    });

    expect(action.kind).toBe("escalated-to-human");
    expect(action.kind).not.toBe("review-only");
    expect(action.primaryLabel).toBeNull();
  });

  it("carries the parked backlog item id, the abandon reason, and a resume href", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: abandonedBuild(),
      governedBacklogEnabled: true,
    });
    if (action.kind !== "escalated-to-human") throw new Error("expected escalated-to-human");

    // originator.itemId in the shared fixture is BI-5B839D74.
    expect(action.parkedBacklogItemId).toBe("BI-5B839D74");
    expect(action.abandonReason).toContain("Escalated to human");
    expect(action.resumeHref).toBe("/ops");
    expect(action.message).toContain("BI-5B839D74");
  });

  it("renders a danger 'Escalated to you' operator status, never 'Working'", () => {
    const build = abandonedBuild();
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true });
    const guidance = deriveBuildStudioOperatorGuidance(action, build);

    expect(guidance.status.kind).toBe("escalated");
    expect(guidance.status.label).toBe("Escalated to you");
    expect(guidance.status.intent).toBe("danger");
    expect(guidance.status.label).not.toBe("Working");
    expect(guidance.status.kind).not.toBe("working");
  });

  it("points the operator at the parked item in Delivery for the next step", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: abandonedBuild(),
      governedBacklogEnabled: true,
    });
    const guidance = deriveBuildStudioOperatorGuidance(action);

    expect(guidance.nextSentence).toContain("BI-5B839D74");
    expect(guidance.nextSentence).toContain("Delivery");
  });

  it("still escalates when there is no originating backlog item", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: abandonedBuild({ originator: null, originatingBacklogItemId: null }),
      governedBacklogEnabled: true,
    });
    if (action.kind !== "escalated-to-human") throw new Error("expected escalated-to-human");

    expect(action.parkedBacklogItemId).toBeNull();
    expect(action.resumeHref).toBe("/ops");
    expect(action.message).toContain("waiting for you in Delivery");
  });
});

describe("deriveBuildStudioOperatorGuidance — terminal owner state", () => {
  it("never presents a completed build as Working", () => {
    const build = makeBuild({ phase: "complete" });
    const action = deriveBuildStudioWorkflowAction({
      build,
      governedBacklogEnabled: true,
    });
    const guidance = deriveBuildStudioOperatorGuidance(action, build);

    expect(guidance.status).toEqual({
      kind: "complete",
      label: "Complete",
      intent: "success",
    });
    expect(guidance.nextSentence).toBe(
      "The result and its evidence are ready to review.",
    );
    expect(guidance.nextLabel).toBeNull();
    expect(guidance.useCoworkerForNext).toBe(false);
  });
});

describe("deriveBuildStudioWorkflowAction — failed inference (BI-F0005EB0)", () => {
  function progressWithInferenceFailure(
    failure: BuildProgressVisibility["inferenceFailure"],
  ): BuildProgressVisibility {
    return {
      buildId: "FB-INF",
      generatedAt: "2026-07-05T12:00:00.000Z",
      statusHeading: { operatorAction: "Monitor build progress", failureAxis: null },
      progress: { primary: { source: "db-task-results", completed: 0, total: 0, observedAt: null }, conflicts: [] },
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
      quietAgent: { quiet: false, minutesQuiet: 0, lastObservableSignalAt: null },
      inferenceFailure: failure,
      phaseRuns: [],
    } satisfies BuildProgressVisibility;
  }

  it("surfaces transient inference failure as a capacity wait with an optional retry", () => {
    const action = deriveBuildStudioWorkflowAction({
      // designDoc null => the advance gate would otherwise fire with a disabledReason.
      build: makeBuild({ phase: "ideate", draftApprovedAt: new Date("2026-04-25T13:00:00Z"), designDoc: null, designReview: null }),
      governedBacklogEnabled: true,
      progressVisibility: progressWithInferenceFailure({ failed: true, kind: "connection", observedAt: "2026-07-05T11:59:00.000Z" }),
    });

    expect(action.kind).toBe("retry-inference");
    expect(action.primaryLabel).toBe("Retry the AI call");
    expect(action.disabledReason).toBeNull();
    expect(action.title).toMatch(/waiting for AI capacity/i);
    // Never leak the raw provider string into user-facing copy.
    expect(action.message).not.toMatch(/ECONNREFUSED|ConnectionRefused|API Error:/);
    expect(deriveBuildStudioOperatorGuidance(action).status).toEqual({
      kind: "waiting-capacity",
      label: "Capacity wait",
      intent: "info",
    });
    expect(deriveBuildStudioOperatorGuidance(action).nextSentence).toMatch(/retry when convenient/i);
  });

  it("keeps configuration failures distinct from transient capacity waits", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({ phase: "ideate", draftApprovedAt: new Date("2026-04-25T13:00:00Z"), designDoc: null, designReview: null }),
      governedBacklogEnabled: true,
      progressVisibility: progressWithInferenceFailure({ failed: true, kind: "config", observedAt: "2026-07-05T11:59:00.000Z" }),
    });

    expect(action.kind).toBe("retry-inference");
    expect(action.title).toMatch(/setup needs attention/i);
    expect(deriveBuildStudioOperatorGuidance(action).status.intent).toBe("danger");
  });

  it("surfaces retry-inference for a failed plan inference", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({ phase: "plan", draftApprovedAt: new Date("2026-04-25T13:00:00Z") }),
      governedBacklogEnabled: true,
      progressVisibility: progressWithInferenceFailure({ failed: true, kind: "rate-limit", observedAt: "2026-07-05T11:59:00.000Z" }),
    });

    expect(action.kind).toBe("retry-inference");
  });

  it("does NOT surface retry-inference when the failure is stale (failed:false)", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({ phase: "ideate", draftApprovedAt: new Date("2026-04-25T13:00:00Z") }),
      governedBacklogEnabled: true,
      progressVisibility: progressWithInferenceFailure({ failed: false, kind: "connection", observedAt: "2026-07-05T11:59:00.000Z" }),
    });

    expect(action.kind).not.toBe("retry-inference");
  });

  it("does NOT surface retry-inference in build phase (scoped to ideate/plan)", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({ phase: "build", draftApprovedAt: new Date("2026-04-25T13:00:00Z") }),
      governedBacklogEnabled: true,
      progressVisibility: progressWithInferenceFailure({ failed: true, kind: "connection", observedAt: "2026-07-05T11:59:00.000Z" }),
    });

    expect(action.kind).not.toBe("retry-inference");
  });
});

describe("a stale AI failure must not hide a satisfied advance gate", () => {
  it("offers Advance to Plan when the design is reviewed, even after an inference failure", () => {
    // The defect that stalled a real build: brief, design doc and build plan
    // were all saved and designReview was "pass", but a pending inference
    // failure pre-empted the advance action. The only offered action was an AI
    // call that could not run, so the build could not move at all.
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "ideate",
        draftApprovedAt: new Date() as never,
        designDoc: { problemStatement: "x", proposedApproach: "y" } as never,
        designReview: { decision: "pass" } as never,
      }),
      governedBacklogEnabled: true,
      progressVisibility: {
        inferenceFailure: { failed: true, kind: "transient" },
      } as never,
    });
    expect(action.kind).not.toBe("retry-inference");
    expect(action.targetPhase).toBe("plan");
  });

  it("still offers Retry the AI call when the gate is NOT satisfied", () => {
    const action = deriveBuildStudioWorkflowAction({
      build: makeBuild({
        phase: "ideate",
        draftApprovedAt: new Date() as never,
        designDoc: null,
        designReview: null,
      }),
      governedBacklogEnabled: true,
      progressVisibility: {
        inferenceFailure: { failed: true, kind: "transient" },
      } as never,
    });
    expect(action.kind).toBe("retry-inference");
  });
});
