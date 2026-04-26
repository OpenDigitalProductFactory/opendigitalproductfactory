import { describe, expect, it } from "vitest";
import {
  deriveBuildStudioWorkflowAction,
  deriveWorkflowStageGuidance,
} from "./build-studio-workflow-actions";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

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

    expect(guidance.title).toBe("Implementation Needs Recovery");
    expect(guidance.nextApproval).toContain("Resume implementation");
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
});
