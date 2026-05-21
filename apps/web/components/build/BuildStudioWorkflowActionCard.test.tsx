// @vitest-environment jsdom
import "../build-studio/test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BuildStudioWorkflowActionCard,
  deriveActionBannerState,
} from "./BuildStudioWorkflowActionCard";
import type { BuildStudioWorkflowAction } from "./build-studio-workflow-actions";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

const { mockAdvanceBuildPhase, mockCaptureDecisionInteraction, mockResumeBuildImplementation } = vi.hoisted(() => ({
  mockAdvanceBuildPhase: vi.fn(),
  mockCaptureDecisionInteraction: vi.fn(),
  mockResumeBuildImplementation: vi.fn(),
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
  resumeBuildImplementation: mockResumeBuildImplementation,
  resetBuildExecution: vi.fn(),
  retryBuildExecution: vi.fn(),
  runBuildReviewVerification: vi.fn(),
}));

vi.mock("@/lib/actions/decision-perspective", () => ({
  captureDecisionInteraction: mockCaptureDecisionInteraction,
}));

beforeEach(() => {
  mockAdvanceBuildPhase.mockReset();
  mockCaptureDecisionInteraction.mockReset();
  mockResumeBuildImplementation.mockReset();
  mockCaptureDecisionInteraction.mockResolvedValue({ status: "captured", captureType: "escalation" });
  mockResumeBuildImplementation.mockResolvedValue({
    mode: "reset-blocked",
    resetTasks: 3,
    dispatchQueued: true,
    message: "Reset 3 tasks to BLOCKED; queued implementation resume.",
  });
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

    expect(html).toContain("Build Status");
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

    expect(html).toContain("Build Status");
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

describe("BuildStudioWorkflowActionCard resume visibility", () => {
  it("renders pre-click resume mode and post-click outcome", async () => {
    const onCompleted = vi.fn();
    const action: BuildStudioWorkflowAction = {
      kind: "resume-implementation",
      title: "Click Resume to re-execute 3 blocked tasks",
      message: "Failure axis: usage-limit. Resume will reset blocked tasks and queue the existing implementation path.",
      primaryLabel: "Resume Implementation",
      targetPhase: null,
      disabledReason: null,
      coworkerLabel: "Review failures with coworker",
      coworkerPrompt: "Explain the usage limit.",
      failureAxis: "usage-limit",
      truthSources: [
        {
          source: "db-task-results",
          completed: 7,
          total: 9,
          observedAt: "2026-05-19T17:23:40.189Z",
        },
      ],
      resumeMode: {
        mode: "reset-blocked",
        label: "Reset blocked tasks",
        reason: "3 blocked tasks will be reset before the existing resume path is queued.",
      },
    };

    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "build" })}
        action={action}
        onCompleted={onCompleted}
      />,
    );

    expect(screen.getByText("Reset blocked tasks")).toBeInTheDocument();
    expect(screen.getByText("DB")).toBeInTheDocument();
    expect(screen.getByText("3 blocked tasks will be reset before the existing resume path is queued.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resume Implementation" }));

    await waitFor(() => {
      expect(screen.getByText("Reset 3 tasks to BLOCKED; queued implementation resume.")).toBeInTheDocument();
    });
    expect(mockResumeBuildImplementation).toHaveBeenCalledWith("FB-9B19098C");
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
});

describe("deriveActionBannerState", () => {
  // The card delegates compact rendering to ActionBanner; this helper is the
  // contract between dispatch + presentation. Pinning the mapping ensures the
  // banner color/detail behavior stays consistent across phase changes.

  it("returns 'blocked' when action.disabledReason is set, regardless of phase", () => {
    expect(deriveActionBannerState({ phase: "ideate" }, { disabledReason: "Awaiting design review" })).toBe("blocked");
    expect(deriveActionBannerState({ phase: "complete" }, { disabledReason: "Decision pending" })).toBe("blocked");
  });

  it("returns 'review_failed' when phase is failed and no disabledReason", () => {
    expect(deriveActionBannerState({ phase: "failed" }, { disabledReason: null })).toBe("review_failed");
  });

  it("returns 'complete' when phase is complete", () => {
    expect(deriveActionBannerState({ phase: "complete" }, { disabledReason: null })).toBe("complete");
  });

  it("returns 'running' when phase is build or review", () => {
    expect(deriveActionBannerState({ phase: "build" }, { disabledReason: null })).toBe("running");
    expect(deriveActionBannerState({ phase: "review" }, { disabledReason: null })).toBe("running");
  });

  it("returns 'ready' for ideate / plan / ship phases", () => {
    expect(deriveActionBannerState({ phase: "ideate" }, { disabledReason: null })).toBe("ready");
    expect(deriveActionBannerState({ phase: "plan" }, { disabledReason: null })).toBe("ready");
    expect(deriveActionBannerState({ phase: "ship" }, { disabledReason: null })).toBe("ready");
  });

  it("disabledReason has higher precedence than phase=failed", () => {
    // If a failed build also reports a disabledReason, the operator should
    // see 'blocked' (action needs them) before 'review_failed' (status info).
    expect(deriveActionBannerState({ phase: "failed" }, { disabledReason: "Resolve upstream first" })).toBe("blocked");
  });
});

describe("BuildStudioWorkflowActionCard compact rendering", () => {
  function actionFor(phase: FeatureBuildRow["phase"]): BuildStudioWorkflowAction {
    return {
      kind: "advance-phase",
      title: "Ready to advance",
      message: "Move this reviewed plan into sandbox execution so the coworker can start work.",
      primaryLabel: "Start Implementation",
      targetPhase: "build",
      disabledReason: null,
      coworkerLabel: "Ask coworker",
      coworkerPrompt: "Tell me what's needed before I can start build.",
    };
  }

  it("compact=true delegates the visible heading + sentence to ActionBanner (one sentence, no duplicate Build Status label)", () => {
    const action = actionFor("plan");
    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "plan", decisionInteraction: null })}
        action={action}
        compact
      />,
    );

    // ActionBanner emits a region with the canonical aria-label.
    const banner = screen.getByRole("region", { name: "Current build action" });
    expect(banner).toBeInTheDocument();
    // The sentence is from action.message — no separate "Build Status" or
    // "Operational status" label duplicates the heading.
    expect(banner).toHaveTextContent(action.message);
    expect(screen.queryByText("Build Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Operational status")).not.toBeInTheDocument();
  });

  it("compact=true exposes a primary action wired to handlePrimaryAction (delegation, not new dispatch)", async () => {
    mockAdvanceBuildPhase.mockResolvedValue({ buildId: "FB-9B19098C" });
    const onCompleted = vi.fn();
    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "plan", decisionInteraction: null })}
        action={actionFor("plan")}
        compact
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Implementation" }));
    await waitFor(() => {
      expect(mockAdvanceBuildPhase).toHaveBeenCalledWith("FB-9B19098C", "build");
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("compact=true with disabledReason renders the banner in 'blocked' state with detail visible", () => {
    const blocked: BuildStudioWorkflowAction = {
      ...actionFor("plan"),
      disabledReason: "Plan review failed. Refine the plan first.",
    };
    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "plan", decisionInteraction: null })}
        action={blocked}
        compact
      />,
    );
    const banner = screen.getByRole("region", { name: "Current build action" });
    expect(banner).toHaveAttribute("data-state", "blocked");
    expect(banner).toHaveTextContent("Plan review failed. Refine the plan first.");
  });

  it("compact=true falls back to the full card when a decision interaction needs capture", () => {
    // makeBuild() default already includes a decisionInteraction that
    // requires capture — perfect setup for the fallback path.
    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "plan" })}
        action={actionFor("plan")}
        compact
      />,
    );
    // Decision panel needs the larger card; the banner does not render here.
    expect(screen.queryByRole("region", { name: "Current build action" })).not.toBeInTheDocument();
    // The full card heading should be present instead.
    expect(screen.getByText("Build Status")).toBeInTheDocument();
  });

  it("compact=false renders the full card unchanged (back-compat with existing callers)", () => {
    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "plan" })}
        action={actionFor("plan")}
      />,
    );
    expect(screen.getByText("Build Status")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Current build action" })).not.toBeInTheDocument();
  });
});
