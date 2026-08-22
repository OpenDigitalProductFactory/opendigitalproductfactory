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

import "@/test-setup";
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
  it("does not mount the drawer before an explicit owner or operator action", () => {
    render(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="abc12345"
      />,
    );
    expect(screen.queryByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer)).not.toBeInTheDocument();
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
    expect(ids).toEqual(["canonical-doc", "progress", "brief", "review"]);
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
    // Before click: the technical drawer stays out of the owner-facing DOM.
    expect(screen.queryByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer)).not.toBeInTheDocument();

    const fleetHeader = screen.getByTestId("build-studio-fleet-header");
    fireEvent.click(fleetHeader);

    await waitFor(() => {
      expect(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer)).toHaveAttribute("data-open", "true");
      // The fleet header used to open a duplicate BS-Queue panel; it now opens
      // real progress detail (BI readable-canvas).
      const progressSection = document.querySelector('[data-testid="details-drawer-section-progress"]');
      expect(progressSection).toHaveAttribute("data-open", "true");
    });
  });

  it("does not re-list the fleet inside the drawer — the rail is the one list", () => {
    render(
      <BuildStudio
        builds={[
          makeBuild({ buildId: "FB-RUNRUNRUN", phase: "build" }),
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
    // The duplicate queue panel is gone: no drawer section re-renders the
    // build list, and its counters (which tallied only running/blocked/queued
    // while listing every row) can no longer disagree with what it shows.
    expect(
      document.querySelector('[data-testid="details-drawer-section-bs-queue"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("AI Coworker workload");
  });
  it("close button unmounts the drawer from the owner-facing DOM", async () => {
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
      expect(screen.queryByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer)).not.toBeInTheDocument();
    });
  });
});
