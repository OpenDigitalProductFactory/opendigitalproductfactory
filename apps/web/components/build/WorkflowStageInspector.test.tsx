// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeHappyPathState, type FeatureBuildRow } from "@/lib/feature-build-types";
import { WorkflowStageInspector } from "./WorkflowStageInspector";

afterEach(cleanup);

vi.mock("./BuildStudioWorkflowActionCard", () => ({
  BuildStudioWorkflowActionCard: () => <div>Primary workflow action</div>,
}));

vi.mock("./build-studio-workflow-actions", () => ({
  deriveWorkflowStageGuidance: () => ({
    nextApproval: "Owner checks release evidence.",
    workflowAction: { kind: "none" },
  }),
}));

describe("WorkflowStageInspector", () => {
  it("adds environment and evidence summaries without exposing internal trace labels", () => {
    render(
      <WorkflowStageInspector
        build={makeBuild()}
        phase="build"
        status="running"
        workflowLabel={null}
        governedBacklogEnabled
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Primary workflow action")).toBeInTheDocument();
    expect(screen.getByText("Environment readiness")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open environment" })).toHaveAttribute("href", "http://localhost:53601");
    expect(screen.getByText("Evidence timeline")).toBeInTheDocument();
    expect(screen.getByText("Local integration")).toBeInTheDocument();
    expect(screen.queryByText(/localhost:53601/i)).toBeNull();
    expect(screen.queryByText(/ExternalEvidenceRecord/i)).toBeNull();
    expect(screen.queryByText(/ToolExecutionReceipt/i)).toBeNull();
  });
});

function makeBuild(): FeatureBuildRow {
  return {
    id: "row-1",
    buildId: "FB-1",
    title: "Shared nonprod flow",
    description: null,
    portfolioId: null,
    originatingBacklogItemId: null,
    brief: null,
    plan: null,
    phase: "build",
    sandboxId: "sandbox-1",
    sandboxPort: 53601,
    diffSummary: "ExternalEvidenceRecord captured a summary.",
    diffPatch: null,
    codingProvider: "codex",
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date("2026-05-26T00:00:00.000Z"),
    updatedAt: new Date("2026-05-26T00:00:00.000Z"),
    draftApprovedAt: null,
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: {
      testsPassed: 4,
      testsFailed: 0,
      typecheckPassed: true,
      fullOutput: "ToolExecutionReceipt recorded the check.",
      timestamp: "2026-05-26T00:00:00.000Z",
    },
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
    happyPathState: normalizeHappyPathState(null),
  };
}
