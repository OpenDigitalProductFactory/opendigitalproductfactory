// @vitest-environment jsdom
//
// apps/web/components/build/BuildStudioNodeInspector.test.tsx
//
// Pins the NodeInspector lifecycle wiring on the BuildStudio shell:
//   - ProcessGraph receives an onNodeClick prop (delegate path).
//   - Calling onNodeClick from the parent's perspective mounts the
//     anchored NodeInspector with title/body derived from the click info.
//   - Re-clicking the same node toggles the inspector closed.
//   - Close button + Esc + click-outside (handled inside NodeInspector)
//     clear the parent's selectedNodeClick state.
//   - The Ask-coworker affordance dispatches the open-agent-panel event
//     with the right prefill string.
//
// We mock ProcessGraph to expose its onNodeClick prop via a global ref
// so the test can fire it as if a real node click had happened.

import "../build-studio/test-setup";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuildStudio } from "./BuildStudio";
import type { ProcessGraphNodeClickInfo } from "./ProcessGraphClickInfo";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

afterEach(cleanup);

// Hoisted refs let the test fire the captured onNodeClick.
const { graphState } = vi.hoisted(() => ({
  graphState: { onNodeClick: null as null | ((info: ProcessGraphNodeClickInfo) => void) },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/actions/build", () => ({
  createFeatureBuild: vi.fn(),
  deleteFeatureBuild: vi.fn(),
}));

vi.mock("@/lib/actions/build-read", () => ({
  getFeatureBuild: vi.fn(),
  getFeatureBuildCustomerStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/actions/build-flow", () => ({
  getBuildFlowStateAction: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/actions/build-progress-visibility", () => ({
  getBuildProgressVisibilityAction: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/actions/code-intelligence", () => ({
  getCodeGraphFreshnessAction: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/actions/assurance", () => ({
  getBuildBomSummary: vi.fn().mockResolvedValue({
    state: "missing",
    document: null,
    counts: { components: 0, models: 0 },
    findings: {
      total: 0,
      blocking: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byKind: {},
    },
    scanner: {
      state: "needs-evaluation",
      approvedScannerCount: 0,
      scannerNames: [],
      reason: "no-approved-scanner",
    },
  }),
  requestBuildBomGeneration: vi.fn(async () => ({ queued: true })),
  requestBuildAssuranceScan: vi.fn(async () => ({ queued: true })),
  getBuildAssuranceFindings: vi.fn(async () => []),
  getProductAssuranceFindings: vi.fn(async () => []),
  setAssuranceFindingStatus: vi.fn(async () => ({ findingKey: "fk-1", previousStatus: "open", status: "planned" })),
  requestBacklogFromAssuranceFinding: vi.fn(async () => ({
    findingKey: "fk-1",
    backlogItemId: "BI-NEW",
    epicCuid: "epic-cuid",
    alreadyLinked: false,
  })),
}));

vi.mock("@/components/build/PhaseIndicator", () => ({
  PhaseIndicator: () => <div data-testid="phase-indicator" />,
}));

vi.mock("@/components/build/FeatureBriefPanel", () => ({
  FeatureBriefPanel: () => <div data-testid="feature-brief-panel" />,
}));

vi.mock("@/components/build/ReviewPanel", () => ({
  ReviewPanel: () => <div data-testid="review-panel" />,
}));

vi.mock("@/components/build/PreviewUrlCard", () => ({
  PreviewUrlCard: () => <div data-testid="preview-url-card" />,
}));

vi.mock("@/components/build/ClaimBadge", () => ({
  ClaimBadge: () => <div data-testid="claim-badge" />,
}));

vi.mock("@/components/build/ProcessGraph", () => ({
  ProcessGraph: (props: { onNodeClick?: (info: ProcessGraphNodeClickInfo) => void }) => {
    graphState.onNodeClick = props.onNodeClick ?? null;
    return <div data-testid="process-graph-mock" />;
  },
}));

vi.mock("@/components/build/ReleaseDecisionPanel", () => ({
  ReleaseDecisionPanel: () => <div data-testid="release-decision-panel" />,
}));

vi.mock("@/components/build/BuildProgressOperationalPanel", () => ({
  BuildProgressOperationalPanel: () => <div data-testid="build-progress-operational-panel" />,
}));

beforeEach(() => {
  graphState.onNodeClick = null;
  // The overseer reframe (BI-90670010) hides the ProcessGraph behind the
  // "Engineer view" toggle by default. These tests exercise the graph/inspector,
  // so render with engineer view enabled (the toggle is localStorage-persisted).
  window.localStorage.setItem("dpf:build-studio-engineer-view", "true");
});

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "row-1",
    buildId: "FB-9B19098C",
    title: "Layout redesign",
    description: null,
    portfolioId: null,
    originatingBacklogItemId: null,
    brief: null,
    plan: null,
    phase: "ideate",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    draftApprovedAt: null,
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
    happyPathState: normalizeHappyPathState(null),
    originator: null,
    phaseHandoffs: [],
    ...overrides,
  };
}

function rect(left: number, top: number, w: number, h: number) {
  return {
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
  } as DOMRect;
}

function mockClickInfo(overrides: Partial<ProcessGraphNodeClickInfo> = {}): ProcessGraphNodeClickInfo {
  return {
    nodeId: "phase-plan",
    kind: "phase",
    phase: "plan",
    anchorRect: rect(540, 200, 120, 60),
    containerRect: rect(0, 0, 1200, 1000),
    containerScrollTop: 0,
    ...overrides,
  };
}

async function renderInTopologyView(buildOverrides: Partial<FeatureBuildRow> = {}) {
  // Post-DetailsDrawer-mount: the workflow graph is the always-visible primary
  // surface of the active-build pane. No tab click needed; ProcessGraph mounts
  // immediately on render. Waits for the mock's onNodeClick prop capture so
  // tests can fire it before asserting against state.
  const result = render(
    <BuildStudio
      builds={[makeBuild(buildOverrides)]}
      portfolios={[]}
      governedBacklogEnabled
      projectBranch="main"
      submissionBranchShortId="abc12345"
    />,
  );
  await screen.findByTestId("process-graph-mock");
  return result;
}

describe("BuildStudio NodeInspector lifecycle", () => {
  it("does NOT mount the inspector until a node is clicked", async () => {
    await renderInTopologyView();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("passes an onNodeClick callback to ProcessGraph (delegate path active)", async () => {
    await renderInTopologyView();
    expect(graphState.onNodeClick).not.toBeNull();
    expect(typeof graphState.onNodeClick).toBe("function");
  });

  it("mounts the anchored NodeInspector when onNodeClick fires (phase node)", async () => {
    await renderInTopologyView();
    graphState.onNodeClick!(mockClickInfo({ nodeId: "phase-plan", phase: "plan" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveAttribute("data-node-id", "phase-plan");
    // Resolved phase title.
    expect(dialog).toHaveTextContent("Plan phase");
  });

  it("mounts the inspector for a task node and renders the implement/testFirst/verify slots", async () => {
    await renderInTopologyView();
    graphState.onNodeClick!(
      mockClickInfo({
        nodeId: "task-T1",
        kind: "task",
        phase: undefined,
        task: {
          taskIndex: 0,
          title: "T1: build-studio-layout.ts",
          specialist: "frontend-engineer",
          files: [],
          task: {
            title: "T1: build-studio-layout.ts",
            implement: "Centralize zone class names and test IDs.",
            testFirst: "Assert no hex literals and test IDs exist.",
            verify: "pnpm --filter web tsc --noEmit",
          } as unknown as ProcessGraphNodeClickInfo["task"] extends infer T
            ? T extends { task: infer P } ? P : never
            : never,
        },
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("T1: build-studio-layout.ts");
    expect(dialog).toHaveTextContent("Implement");
    expect(dialog).toHaveTextContent("Test first");
    expect(dialog).toHaveTextContent("Verify");
    expect(dialog).toHaveTextContent("frontend-engineer");
  });

  it("re-clicking the same node toggles the inspector closed", async () => {
    await renderInTopologyView();
    act(() => {
      graphState.onNodeClick!(mockClickInfo({ nodeId: "phase-build", phase: "build" }));
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Re-click same node — toggles closed.
    act(() => {
      graphState.onNodeClick!(mockClickInfo({ nodeId: "phase-build", phase: "build" }));
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("clicking a different node swaps the inspector content (not stacks)", async () => {
    await renderInTopologyView();
    graphState.onNodeClick!(mockClickInfo({ nodeId: "phase-plan", phase: "plan" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Plan phase");
    graphState.onNodeClick!(mockClickInfo({ nodeId: "phase-build", phase: "build" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("data-node-id", "phase-build");
    expect(dialog).toHaveTextContent("Build phase");
    // Still only one dialog.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("close button clears the parent's selectedNodeClick state", async () => {
    await renderInTopologyView();
    graphState.onNodeClick!(mockClickInfo());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close inspector"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Esc closes the inspector (via NodeInspector's capture-phase keydown)", async () => {
    await renderInTopologyView();
    graphState.onNodeClick!(mockClickInfo());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("Ask-coworker button dispatches open-agent-panel with the right prefill", async () => {
    const handler = vi.fn();
    document.addEventListener("open-agent-panel", handler as EventListener);
    try {
      await renderInTopologyView();
      graphState.onNodeClick!(mockClickInfo({ nodeId: "phase-build", phase: "build" }));
      await screen.findByRole("dialog");
      fireEvent.click(screen.getByTestId("node-inspector-ask-coworker"));
      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as CustomEvent<{ autoMessage: string; targetBuildId: string }>;
      expect(event.detail.autoMessage).toContain("FB-9B19098C");
      expect(event.detail.autoMessage).toContain("build");
      expect(event.detail.targetBuildId).toBe("FB-9B19098C");
    } finally {
      document.removeEventListener("open-agent-panel", handler as EventListener);
    }
  });
});
