import { describe, expect, it } from "vitest";
import {
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
    expect(action.primaryLabel).toBe("Resume Implementation");
    expect(action.message).toContain("healthy sandbox");
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
    expect(action.title).toBe("Click Resume to re-execute 3 blocked tasks");
    expect(action.failureAxis).toBe("usage-limit");
    expect(action.message).toContain("usage-limit");
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
    expect(action.title).toBe("Click Resume to re-execute 2 blocked tasks");
    expect(action.failureAxis).toBe("usage-limit");
    expect(action.message).toContain("usage-limit");
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
    expect(action.primaryLabel).toBe("Resume Implementation");
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

    expect(guidance.title).toBe("Click Resume to re-execute 1 blocked task");
    expect(guidance.nextApproval).toContain("Resume implementation");
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

    expect(guidance.title).toBe("Click Resume to re-execute 3 blocked tasks");
    expect(guidance.workflowAction.failureAxis).toBe("usage-limit");
    expect(guidance.workflowAction.message).toContain("usage-limit");
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
    expect(guidance.title).toBe("Click Resume to re-execute 2 blocked tasks");
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
