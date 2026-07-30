// @vitest-environment jsdom
import "../build-studio/test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BuildStudioWorkflowActionCard,
  deriveActionBannerState,
} from "./BuildStudioWorkflowActionCard";
import {
  deriveBuildStudioWorkflowAction,
  type BuildStudioWorkflowAction,
} from "./build-studio-workflow-actions";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";
import type { BuildStudioCustodianPrompt } from "./build-studio-custodian";

const { mockAdvanceBuildPhase, mockCaptureDecisionInteraction, mockRerunPlanReview, mockResumeBuildImplementation } = vi.hoisted(() => ({
  mockAdvanceBuildPhase: vi.fn(),
  mockCaptureDecisionInteraction: vi.fn(),
  mockRerunPlanReview: vi.fn(),
  mockResumeBuildImplementation: vi.fn(),
}));

const mockRouterPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: mockRouterPush,
  }),
}));

vi.mock("@/lib/actions/build", () => ({
  advanceBuildPhase: mockAdvanceBuildPhase,
  approveBuildStart: vi.fn(),
  recordBuildAcceptance: vi.fn(),
  rerunPlanReview: mockRerunPlanReview,
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
  // advanceBuildPhase returns AdvanceBuildPhaseResult (BI-8C6AA60E) — default the
  // mock to the success shape so the card's !outcome.ok check reflects reality.
  mockAdvanceBuildPhase.mockResolvedValue({ ok: true });
  mockCaptureDecisionInteraction.mockReset();
  mockRerunPlanReview.mockReset();
  mockResumeBuildImplementation.mockReset();
  mockCaptureDecisionInteraction.mockResolvedValue({ status: "captured", captureType: "escalation" });
  mockResumeBuildImplementation.mockResolvedValue({
    mode: "reset-blocked",
    resetTasks: 3,
    dispatchQueued: true,
    message: "Reset 3 tasks to BLOCKED; queued implementation resume.",
  });
  mockRerunPlanReview.mockResolvedValue({
    success: true,
    message: "Plan review passed; implementation is unlocked.",
  });
});

function custodianPrompt(
  overrides: Partial<BuildStudioCustodianPrompt> = {},
): BuildStudioCustodianPrompt {
  return {
    dismissKey: "custodian",
    title: "I can keep this review moving.",
    whyNow: "UX verification still needs clean evidence.",
    recommendedAction: "I can collect the acceptance evidence.",
    primaryLabel: "Let AI Coworker handle it",
    primaryAction: "coworker",
    coworkerPrompt: "Act as the Build Studio custodian.",
    statusLabel: "Needs evidence",
    intent: "warning",
    details: ["Review evidence is missing."],
    proactivityPlan: {
      resolvedLevel: "assertive",
      policyId: "proactivity:build-studio-custodian:assertive",
      attentionWindowMinutes: 30,
      followUpCadenceMinutes: [30, 60, 120],
      maxAttempts: 3,
      spendClass: "elevated",
      channelPolicy: "urgent-channel",
      escalationTarget: "platform-operator",
      actionBoundary: "propose",
      explanation: "Build Studio work is blocked or stalled.",
      evidenceRefs: [{ kind: "activity-family", id: "build-studio-custodian" }],
    },
    ...overrides,
  };
}

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
      scoredOptions: null,
      recommendedOptionId: null,
      chosenOptionId: null,
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

  // BI-8C6AA60E: the regression guard. Before this, "no releasable source changes"
  // was THROWN from a Server Action, so production stripped it to a digest and a
  // build that had passed every gate failed with an unexplained render error.
  it("surfaces a returned no-releasable-changes message to the operator", async () => {
    const message =
      "No releasable source changes are present in the sandbox. Resume implementation and make a real code change before continuing to release.";
    mockAdvanceBuildPhase.mockResolvedValueOnce({ ok: false, message });

    render(
      <BuildStudioWorkflowActionCard build={makeBuild()} action={implementationAction()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Implementation" }));

    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });
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

    fireEvent.click(screen.getByRole("button", { name: "Capture owner direction" }));
    fireEvent.change(screen.getByLabelText("Owner direction"), {
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
      title: "3 tasks need another pass",
      message: "Some work did not pass its checks yet. Next: click Try to fix to rerun the failed work from Build Studio.",
      primaryLabel: "Try to fix",
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
    expect(screen.getByText("Blocked (technical)")).toBeInTheDocument();
    expect(screen.getByTestId("build-next-action")).toHaveTextContent("Next: try to fix the failed work. I will rerun the recovery path.");
    expect(screen.getByTestId("build-guided-recovery")).toHaveTextContent("Something looks off");
    expect(screen.getByText("DB")).toBeInTheDocument();
    expect(screen.getByText("3 blocked tasks will be reset before the existing resume path is queued.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try to fix" }));

    await waitFor(() => {
      expect(screen.getByText("Reset 3 tasks to BLOCKED; queued implementation resume.")).toBeInTheDocument();
    });
    expect(mockResumeBuildImplementation).toHaveBeenCalledWith("FB-9B19098C");
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("renders plan-review failure as guided in-place recovery", async () => {
    const onCompleted = vi.fn();
    const action: BuildStudioWorkflowAction = {
      kind: "rerun-plan-review",
      title: "Plan review needs a fix",
      message: "The plan review did not pass. Next: click Try to fix to rerun the guided recovery in Build Studio.",
      primaryLabel: "Try to fix",
      targetPhase: null,
      disabledReason: null,
      coworkerLabel: "Something looks off",
      coworkerPrompt: "Explain the blocking issues in plain language.",
    };

    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "plan", decisionInteraction: null })}
        action={action}
        onCompleted={onCompleted}
      />,
    );

    expect(screen.getByText("Waiting on you")).toBeInTheDocument();
    expect(screen.getByTestId("build-next-action")).toHaveTextContent("Next: try to fix the plan review here.");
    expect(screen.getByTestId("build-guided-recovery")).toHaveTextContent("Try to fix");
    expect(screen.getByRole("button", { name: "Something looks off" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try to fix" }));

    await waitFor(() => {
      expect(mockRerunPlanReview).toHaveBeenCalledWith("FB-9B19098C");
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
});

describe("BuildStudioWorkflowActionCard decomposition affordances", () => {
  it("emits the open-build-decomposition event for Decompose now", async () => {
    const received: unknown[] = [];
    const handler = (event: Event) => {
      received.push((event as CustomEvent).detail);
    };
    document.addEventListener("open-build-decomposition", handler);

    try {
      const action: BuildStudioWorkflowAction = {
        kind: "decompose-now",
        title: "Plan Review Is Oscillating",
        message: "Plan review is oscillating; split this into smaller builds.",
        primaryLabel: "Decompose now",
        targetPhase: null,
        disabledReason: null,
        coworkerLabel: "Review with coworker",
        coworkerPrompt: "Explain the split.",
      };
      const onCompleted = vi.fn();

      render(
        <BuildStudioWorkflowActionCard
          build={makeBuild({ decisionInteraction: null })}
          action={action}
          onCompleted={onCompleted}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Decompose now" }));

      await waitFor(() => {
        expect(received).toEqual([{ buildId: "FB-9B19098C" }]);
      });
      expect(onCompleted).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("open-build-decomposition", handler);
    }
  });

  it("emits the open-parent-design-amendment event for child builds", async () => {
    const received: unknown[] = [];
    const handler = (event: Event) => {
      received.push((event as CustomEvent).detail);
    };
    document.addEventListener("open-parent-design-amendment", handler);
    const action: BuildStudioWorkflowAction = {
      kind: "amend-parent-design",
      title: "Amend Parent Design",
      message: "This child is still too large; amend the parent design instead.",
      primaryLabel: "Amend parent design",
      targetPhase: null,
      disabledReason: null,
      coworkerLabel: "Amend with coworker",
      coworkerPrompt: "Help me amend the parent design instead of decomposing this child.",
    };

    try {
      render(
        <BuildStudioWorkflowActionCard
          build={makeBuild({ buildId: "FB-CHILD", parentEpicId: "epic-row-1", decisionInteraction: null })}
          action={action}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Amend parent design" }));

      await waitFor(() => {
        expect(received).toEqual([{ buildId: "FB-CHILD" }]);
      });
    } finally {
      document.removeEventListener("open-parent-design-amendment", handler);
    }
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

  // BI-A2F3FA9D — an abandoned (escalated-to-human) build is terminal and maps
  // to the danger 'escalated' banner, taking precedence over any disabledReason.
  it("returns 'escalated' when phase is abandoned", () => {
    expect(deriveActionBannerState({ phase: "abandoned" }, { disabledReason: null })).toBe("escalated");
    expect(deriveActionBannerState({ phase: "abandoned" }, { disabledReason: "anything" })).toBe("escalated");
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
    // The compact sentence is the derived one-line Next action, paired with a
    // single operator status.
    expect(banner).toHaveTextContent("Waiting on you");
    expect(banner).toHaveTextContent("Next: start implementation. I will track the checks.");
    expect(screen.queryByText("Build Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Operational status")).not.toBeInTheDocument();
  });

  // BI-A2F3FA9D — a build escalated to a human must show the terminal handoff,
  // never the old stale "Working — watching this stage".
  it("compact=true renders the escalate-to-human handoff for an abandoned build (not 'Working')", async () => {
    const build = makeBuild({
      phase: "abandoned",
      decisionInteraction: null,
      abandonReason:
        "Escalated to human after 2 self-repair round(s) at plan review (needs-human).",
      abandonedAt: new Date("2026-07-04T18:00:00Z"),
      originator: {
        id: "backlog-row-1",
        itemId: "BI-DEADBEEF",
        title: "Some parked work",
        status: "deferred",
        triageOutcome: "build",
        effortSize: "large",
        proposedOutcome: null,
        activeBuildId: null,
        resolution: null,
        abandonReason: null,
      },
    });
    const action = deriveBuildStudioWorkflowAction({ build, governedBacklogEnabled: true });
    render(
      <BuildStudioWorkflowActionCard build={build} action={action} compact />,
    );

    const banner = screen.getByRole("region", { name: "Current build action" });
    expect(banner).toHaveTextContent("Escalated to you");
    expect(banner).toHaveTextContent("BI-DEADBEEF");
    expect(banner).not.toHaveTextContent("Working");

    // The primary affordance is the resume path to the parked item.
    const openParked = screen.getByRole("button", { name: "Open parked item" });
    fireEvent.click(openParked);
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith("/ops"));
  });

  it("compact=true exposes a primary action wired to handlePrimaryAction (delegation, not new dispatch)", async () => {
    mockAdvanceBuildPhase.mockResolvedValue({ ok: true });
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
    expect(banner).toHaveTextContent("Waiting on you");
    expect(banner).toHaveTextContent("Next: ask the AI Coworker to collect the missing evidence.");
    expect(banner).toHaveTextContent("Plan review failed. Refine the plan first.");
  });

  it("compact=true replaces the banner with custodian prompt when proactive help is active", () => {
    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "review", decisionInteraction: null })}
        action={implementationAction({ primaryLabel: "Run UX Verification" })}
        compact
        custodianPrompt={custodianPrompt({
          dismissKey: "custodian-one",
        })}
      />,
    );

    expect(screen.queryByRole("region", { name: "Current build action" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AI Coworker proactive help" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Let AI Coworker handle it/ })).toBeInTheDocument();
  });

  it("custodian coworker action opens the agent panel with the custodian prompt", () => {
    const listener = vi.fn();
    document.addEventListener("open-agent-panel", listener);
    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "review", decisionInteraction: null })}
        action={implementationAction({ primaryLabel: "Run UX Verification" })}
        compact
        custodianPrompt={custodianPrompt({
          dismissKey: "custodian-two",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Let AI Coworker handle it/ }));

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail.autoMessage).toBe("Act as the Build Studio custodian.");
    expect(event.detail.targetBuildId).toBe("FB-9B19098C");
    document.removeEventListener("open-agent-panel", listener);
  });

  it("custodian workflow action reuses the existing primary dispatch", async () => {
    render(
      <BuildStudioWorkflowActionCard
        build={makeBuild({ phase: "plan", decisionInteraction: null })}
        action={implementationAction()}
        compact
        custodianPrompt={custodianPrompt({
          dismissKey: "custodian-three",
          title: "I found the recovery path.",
          whyNow: "This stop has a guided repair.",
          recommendedAction: "Try the guided fix now.",
          primaryLabel: "Start Implementation",
          primaryAction: "workflow",
          statusLabel: "Blocked",
          intent: "danger",
          details: ["Use the existing dispatch."],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Start Implementation/ }));

    await waitFor(() => {
      expect(mockAdvanceBuildPhase).toHaveBeenCalledWith("FB-9B19098C", "build");
    });
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
