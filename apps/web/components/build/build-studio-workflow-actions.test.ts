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
});
