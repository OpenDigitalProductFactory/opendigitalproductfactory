import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskInspector } from "@/components/build/TaskInspector";
import { WorkflowStageInspector } from "@/components/build/WorkflowStageInspector";
import { ReleaseDecisionInspector } from "@/components/build/ReleaseDecisionInspector";
import type { BuildFlowState } from "@/lib/build-flow-state";
import { normalizeHappyPathState, type FeatureBuildRow } from "@/lib/feature-build-types";
import type { AssignedTask } from "@/lib/integrate/task-dependency-graph";

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "1",
    buildId: "FB-WORKFLOW",
    title: "Workflow Layout",
    description: null,
    portfolioId: null,
    originatingBacklogItemId: null,
    brief: {
      title: "Workflow Layout",
      description: "Improve the Build Studio workflow detail experience.",
      portfolioContext: "Build Studio",
      targetRoles: ["operators"],
      inputs: ["workflow selection"],
      dataNeeds: "Build stages, task results, and release records",
      acceptanceCriteria: [
        "Workflow details stay inside Build Studio",
        "The coworker remains visible while reviewing details",
      ],
    },
    plan: null,
    phase: "ship",
    sandboxId: "sandbox-1",
    sandboxPort: 3001,
    diffSummary: "Workflow layout changes",
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: { productId: "DP-1", version: "1.0.0", backlogCount: 2 },
    createdById: "u1",
    createdAt: new Date("2026-04-24T12:00:00Z"),
    updatedAt: new Date("2026-04-24T12:00:00Z"),
    draftApprovedAt: null,
    designDoc: null,
    designReview: null,
    buildPlan: {
      fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Improve layout" }],
      tasks: [{ title: "Refine workflow layout", testFirst: "Add layout tests", implement: "Refactor pane structure", verify: "Review in browser" }],
    },
    planReview: null,
    taskResults: [
      {
        taskIndex: 0,
        title: "Refine workflow layout",
        testResult: { passed: true, output: "All layout tests passed." },
        codeReview: { decision: "pass", issues: [], summary: "Looks good." },
        commitSha: "abc123",
      },
    ],
    verificationOut: null,
    acceptanceMet: null,
    scoutFindings: null,
    uxTestResults: [{ step: "Inspect workflow layout", passed: true, screenshotUrl: null, error: null }],
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

function makeTask(): AssignedTask {
  return {
    taskIndex: 0,
    title: "Refine workflow layout",
    specialist: "software-engineer",
    task: {
      title: "Refine workflow layout",
      testFirst: "Add tests for inline detail panels",
      implement: "Move inspectors into the workflow pane",
      verify: "Review in browser",
    },
    files: [
      {
        path: "apps/web/components/build/BuildStudio.tsx",
        action: "modify",
        purpose: "Improve workflow layout",
      },
    ],
  };
}

const flowState: BuildFlowState = {
  buildId: "FB-WORKFLOW",
  currentPhase: "ship",
  mainTrack: [
    { phase: "ideate", label: "Ideate", stepsCompleted: 3, stepsTotal: 3, state: "done" },
    { phase: "plan", label: "Plan", stepsCompleted: 2, stepsTotal: 2, state: "done" },
    { phase: "build", label: "Build", stepsCompleted: 4, stepsTotal: 4, state: "done" },
    { phase: "review", label: "Review", stepsCompleted: 3, stepsTotal: 3, state: "done" },
    { phase: "ship", label: "Ready to Ship", stepsCompleted: 1, stepsTotal: 2, state: "active" },
  ],
  upstream: {
    state: "errored",
    prUrl: null,
    prNumber: null,
    packId: "FP-TEST",
    errorMessage: "GitHub OAuth is not configured yet.",
  },
  promote: {
    state: "scheduled",
    promotionId: "CP-123",
    deployedAt: null,
    scheduleDescription: "Tonight at 8pm",
    rollbackReason: null,
    errorMessage: null,
  },
  allApplicableForksTerminal: true,
};

describe("workflow inspectors", () => {
  it("renders the task inspector as an inline workflow detail panel", () => {
    const html = renderToStaticMarkup(
      <TaskInspector
        task={makeTask()}
        status="done"
        result={{
          title: "Refine workflow layout",
          specialist: "software-engineer",
          outcome: "DONE",
          durationMs: 1200,
        }}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('data-testid="workflow-detail-panel"');
    expect(html).toContain('data-inspector-mode="inline"');
    expect(html).not.toContain("position:fixed");
  });

  it("renders the phase inspector inline instead of as a fullscreen modal", () => {
    const html = renderToStaticMarkup(
      <WorkflowStageInspector
        build={makeBuild()}
        phase="ship"
        status="running"
        workflowLabel="Ready to Release"
        onClose={() => {}}
      />,
    );

    expect(html).toContain('data-testid="workflow-detail-panel"');
    expect(html).toContain("Workflow Stage");
    expect(html).not.toContain("position:fixed");
  });

  it("renders the release decision inspector inline and preserves the operational context", () => {
    const html = renderToStaticMarkup(
      <ReleaseDecisionInspector
        build={makeBuild()}
        flowState={flowState}
        forkKind="promote"
        onClose={() => {}}
      />,
    );

    expect(html).toContain('data-testid="workflow-detail-panel"');
    expect(html).toContain("Operational Change");
    expect(html).not.toContain("position:fixed");
  });
});
