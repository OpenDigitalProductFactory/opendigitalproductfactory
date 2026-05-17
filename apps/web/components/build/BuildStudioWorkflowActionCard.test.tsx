// @vitest-environment jsdom
import "../build-studio/test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BuildStudioWorkflowActionCard } from "./BuildStudioWorkflowActionCard";
import type { BuildStudioWorkflowAction } from "./build-studio-workflow-actions";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

const { mockAdvanceBuildPhase, mockCaptureDecisionInteraction } = vi.hoisted(() => ({
  mockAdvanceBuildPhase: vi.fn(),
  mockCaptureDecisionInteraction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/actions/build", () => ({
  advanceBuildPhase: mockAdvanceBuildPhase,
  approveBuildStart: vi.fn(),
  recordBuildAcceptance: vi.fn(),
  resumeBuildImplementation: vi.fn(),
  retryBuildExecution: vi.fn(),
  runBuildReviewVerification: vi.fn(),
}));

vi.mock("@/lib/actions/decision-perspective", () => ({
  captureDecisionInteraction: mockCaptureDecisionInteraction,
}));

beforeEach(() => {
  mockAdvanceBuildPhase.mockReset();
  mockCaptureDecisionInteraction.mockReset();
  mockCaptureDecisionInteraction.mockResolvedValue({ status: "captured", captureType: "escalation" });
});

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "build-row-1",
    buildId: "FB-9B19098C",
    title: "Add WWMD visibility",
    description: "Surface the decision perspective ledger in Build Studio.",
    portfolioId: null,
    originatingBacklogItemId: null,
    brief: null,
    plan: null,
    phase: "plan",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date("2026-05-17T20:00:00.000Z"),
    updatedAt: new Date("2026-05-17T20:00:00.000Z"),
    draftApprovedAt: new Date("2026-05-17T20:00:00.000Z"),
    designDoc: null,
    designReview: null,
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
    originator: null,
    phaseHandoffs: [],
    happyPathState: normalizeHappyPathState(null),
    decisionInteraction: {
      interactionId: "DI-ABC123",
      profileId: "mark-dpf-platform",
      profileVersionId: "DPV-1",
      domainClass: "plan-readiness",
      outcomeType: "escalate",
      confidenceBefore: 0.72,
      confidenceAfter: 0.6,
      confidenceScore: 0.6,
      materialCount: 2,
      principleConflict: false,
      rationale: "WWMD requires escalation before implementation starts.",
      createdAt: new Date("2026-05-17T20:00:00.000Z"),
      sources: [],
      escalationCaptured: false,
      deferralCaptured: false,
    },
    ...overrides,
  };
}

function implementationAction(overrides: Partial<BuildStudioWorkflowAction> = {}): BuildStudioWorkflowAction {
  return {
    kind: "advance-phase",
    title: "Ready for Implementation",
    message: "Move this reviewed plan into sandbox execution.",
    primaryLabel: "Start Implementation",
    targetPhase: "build",
    disabledReason: null,
    coworkerLabel: "Refine the plan",
    coworkerPrompt: "Review the plan.",
    ...overrides,
  } as BuildStudioWorkflowAction;
}

describe("BuildStudioWorkflowActionCard WWMD visibility", () => {
  it("assembles the WWMD panel inside the plan to build action card", () => {
    const html = renderToStaticMarkup(
      <BuildStudioWorkflowActionCard
        build={makeBuild()}
        action={implementationAction()}
      />,
    );

    expect(html).toContain("Studio Control");
    expect(html).toContain("WWMD gate");
    expect(html).toContain("Escalation required");
  });

  it("does not render WWMD details for other workflow actions", () => {
    const html = renderToStaticMarkup(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "build" })}
        action={implementationAction({ targetPhase: "review", primaryLabel: "Run Verification Review" })}
      />,
    );

    expect(html).toContain("Studio Control");
    expect(html).not.toContain("WWMD gate");
  });

  it("refreshes the build after WWMD blocks the primary action", async () => {
    mockAdvanceBuildPhase.mockRejectedValueOnce(
      new Error("WWMD requires escalation before implementation starts."),
    );
    const onCompleted = vi.fn();

    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild()}
        action={implementationAction()}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Implementation" }));

    await waitFor(() => {
      expect(screen.getByText("WWMD requires escalation before implementation starts.")).toBeInTheDocument();
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("persists WWMD human direction from the action card", async () => {
    const onCompleted = vi.fn();

    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild()}
        action={implementationAction()}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Capture human direction" }));
    fireEvent.change(screen.getByLabelText("Human direction"), {
      target: { value: "Proceed after the owner confirms the implementation scope." },
    });
    fireEvent.change(screen.getByLabelText("Decision criteria"), {
      target: { value: "Owner accepted scope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save WWMD capture" }));

    await waitFor(() => {
      expect(mockCaptureDecisionInteraction).toHaveBeenCalledWith({
        buildId: "FB-9B19098C",
        interactionId: "DI-ABC123",
        outcomeType: "escalate",
        answer: "Proceed after the owner confirms the implementation scope.",
        criteriaText: "Owner accepted scope",
        rationale: "",
        objectionsResolvedText: "",
        suggestedSourceTypesText: "",
        candidateMaterial: false,
      });
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
});
