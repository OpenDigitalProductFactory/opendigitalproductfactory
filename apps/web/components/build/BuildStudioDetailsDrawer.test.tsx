// @vitest-environment jsdom
//
// apps/web/components/build/BuildStudioDetailsDrawer.test.tsx
//
// Pins the DetailsDrawer integration on BuildStudio:
//   - Pill click toggles the drawer open/closed.
//   - Drawer mounts the canonical sections (Progress, Brief, Review, BS Queue).
//   - Default-open section follows phase:
//       ideate / plan → Brief
//       build         → Progress
//       review/ship/complete → Review
//   - Fleet queue header click opens drawer scrolled to BS-Queue.

import "../build-studio/test-setup";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuildStudio } from "./BuildStudio";
import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.setItem("dpf:build-studio-engineer-view", "true");
});

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
  ProcessGraph: () => <div data-testid="process-graph-mock" />,
}));

vi.mock("@/components/build/ReleaseDecisionPanel", () => ({
  ReleaseDecisionPanel: () => <div data-testid="release-decision-panel" />,
}));

vi.mock("@/components/build/BuildProgressOperationalPanel", () => ({
  BuildProgressOperationalPanel: () => <div data-testid="build-progress-operational-panel" />,
}));

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

describe("BuildStudio DetailsDrawer integration", () => {
  it("drawer starts closed (translate-x-full + data-open=false)", () => {
    render(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    const drawer = screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer);
    expect(drawer).toHaveAttribute("data-open", "false");
    expect(drawer.className).toContain("translate-x-full");
  });

  it("pill click opens the drawer", async () => {
    render(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    const pill = screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerPill);
    fireEvent.click(pill);
    await waitFor(() => {
      const drawer = screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer);
      expect(drawer).toHaveAttribute("data-open", "true");
      expect(drawer.className).toContain("translate-x-0");
    });
  });

  it("renders the canonical drawer sections in order", () => {
    render(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    // Open the drawer so section content materializes.
    fireEvent.click(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerPill));
    const sectionHeaders = document.querySelectorAll("[data-section-id]");
    const ids = Array.from(sectionHeaders).map((s) => s.getAttribute("data-section-id"));
    expect(ids).toEqual(["canonical-doc", "progress", "brief", "review", "bs-queue"]);
  });

  it("phase=ideate → Brief is default-open", () => {
    render(
      <BuildStudio
        builds={[makeBuild({ phase: "ideate" })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    fireEvent.click(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerPill));
    const briefSection = document.querySelector('[data-section-id="brief"]');
    expect(briefSection).toHaveAttribute("data-open", "true");
    // FeatureBriefPanel mock renders inside the open section.
    expect(screen.getByTestId("feature-brief-panel")).toBeInTheDocument();
  });

  it("phase=build → Progress is default-open", () => {
    render(
      <BuildStudio
        builds={[makeBuild({ phase: "build" })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    fireEvent.click(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerPill));
    const progressSection = document.querySelector('[data-section-id="progress"]');
    expect(progressSection).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("build-progress-operational-panel")).toBeInTheDocument();
  });

  it("phase=review → Review is default-open", () => {
    render(
      <BuildStudio
        builds={[makeBuild({ phase: "review" })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    fireEvent.click(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerPill));
    const reviewSection = document.querySelector('[data-section-id="review"]');
    expect(reviewSection).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("review-panel")).toBeInTheDocument();
  });

  it("fleet queue header click opens drawer with BS-Queue section default-open", async () => {
    render(
      <BuildStudio
        builds={[makeBuild({ phase: "ideate" })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    // Before click: drawer closed, Brief default (phase=ideate)
    const drawer = screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer);
    expect(drawer).toHaveAttribute("data-open", "false");

    const fleetHeader = screen.getByTestId("build-studio-fleet-header");
    fireEvent.click(fleetHeader);

    await waitFor(() => {
      expect(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer)).toHaveAttribute("data-open", "true");
      const queueSection = document.querySelector(`[data-testid="${BUILD_STUDIO_TEST_IDS.detailsDrawerQueue}"]`);
      expect(queueSection).toHaveAttribute("data-open", "true");
    });
  });

  it("BS-Queue section lists builds with kind + buildId", () => {
    render(
      <BuildStudio
        builds={[
          makeBuild({ buildId: "FB-RUNRUNRUN", phase: "build" }),
          // BI-5939B62F: ideate/plan now derive to "running", so use a still-idle
          // phase (ship with acceptance recorded → idle, not needs-you) to keep
          // the running → idle sort covered.
          makeBuild({
            buildId: "FB-IDLEEEEEE",
            phase: "ship",
            acceptanceMet: true as unknown as FeatureBuildRow["acceptanceMet"],
          }),
        ]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    fireEvent.click(screen.getByTestId("build-studio-fleet-header"));
    const queueSection = document.querySelector(`[data-testid="${BUILD_STUDIO_TEST_IDS.detailsDrawerQueue}"]`);
    expect(queueSection).toBeInTheDocument();
    // Both rows rendered, sorted running → idle.
    const rows = queueSection!.querySelectorAll("[data-build-id]");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-build-id", "FB-RUNRUNRUN");
    expect(rows[0]).toHaveAttribute("data-queue-kind", "running");
    expect(rows[1]).toHaveAttribute("data-build-id", "FB-IDLEEEEEE");
    expect(rows[1]).toHaveAttribute("data-queue-kind", "idle");
  });

  it("close button on the drawer closes it back to translate-x-full", async () => {
    render(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    fireEvent.click(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerPill));
    await waitFor(() => {
      expect(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer)).toHaveAttribute("data-open", "true");
    });
    fireEvent.click(screen.getByLabelText("Close details drawer"));
    await waitFor(() => {
      expect(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer)).toHaveAttribute("data-open", "false");
    });
  });
});
