// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildStudio } from "./BuildStudio";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";
import type { EpicRollupView } from "@/lib/build/epic-rollup";
import type { PortalContextEnvelope } from "@/lib/portal-context";

afterEach(cleanup);

const routerMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

const backlogBuildMocks = vi.hoisted(() => ({
  createBuildStudioBacklogIntake: vi.fn(),
  startBacklogBuild: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerMocks.refresh,
    replace: routerMocks.replace,
  }),
}));

vi.mock("@/lib/actions/build", () => ({
  approveBuildStart: vi.fn(),
  advanceBuildPhase: vi.fn(),
  createFeatureBuild: vi.fn(),
  deleteFeatureBuild: vi.fn(),
  resetBuildExecution: vi.fn(),
  retryBuildExecution: vi.fn(),
}));

vi.mock("@/lib/actions/backlog-build", () => ({
  createBuildStudioBacklogIntake: backlogBuildMocks.createBuildStudioBacklogIntake,
  startBacklogBuild: backlogBuildMocks.startBacklogBuild,
}));

vi.mock("@/lib/actions/build-read", () => ({
  getFeatureBuild: vi.fn(),
}));

vi.mock("@/lib/actions/build-flow", () => ({
  getBuildFlowStateAction: vi.fn(),
}));

vi.mock("@/lib/actions/build-progress-visibility", () => ({
  getBuildProgressVisibilityAction: vi.fn(),
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
  ProcessGraph: () => <div data-testid="process-graph" />,
}));

vi.mock("@/components/build/ReleaseDecisionPanel", () => ({
  ReleaseDecisionPanel: () => <div data-testid="release-decision-panel" />,
}));

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "build-row-1",
    buildId: "FB-9B19098C",
    title: "Fix Build Studio header/content overlap in workflow view",
    description: "A real keeper bugfix for the governed Build Studio flow.",
    portfolioId: null,
    originatingBacklogItemId: "backlog-row-1",
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
    createdAt: new Date("2026-04-25T12:00:00Z"),
    updatedAt: new Date("2026-04-25T12:00:00Z"),
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
    ...overrides,
  };
}

function makeEpicRollup(overrides: Partial<EpicRollupView> = {}): EpicRollupView {
  return {
    epicId: "EP-TRUCK-STOCK",
    title: "Truck stock tracker",
    updatedAt: new Date("2026-05-25T12:00:00Z"),
    status: "in-progress",
    backlogItems: [
      { itemId: "BI-ORIGIN", title: "Track truck parts", status: "in-progress", isOriginating: true },
      { itemId: "BI-RESTOCK", title: "Surface restock needs", status: "open", isOriginating: false },
    ],
    backlogSummary: "2 backlog items",
    childPhases: [
      { phase: "complete", count: 1 },
      { phase: "build", count: 1 },
      { phase: "plan", count: 1 },
    ],
    children: [
      {
        buildId: "FB-READ",
        title: "Truck and parts read",
        phase: "complete",
        childOrder: 1,
        waitingOn: [],
        updatedAt: new Date("2026-05-25T10:00:00Z"),
      },
      {
        buildId: "FB-USAGE",
        title: "Record usage",
        phase: "build",
        childOrder: 2,
        waitingOn: [],
        updatedAt: new Date("2026-05-25T11:00:00Z"),
      },
      {
        buildId: "FB-LOW",
        title: "Low-stock surfacing",
        phase: "plan",
        childOrder: 3,
        waitingOn: ["Record usage"],
        updatedAt: new Date("2026-05-25T11:30:00Z"),
      },
    ],
    rollupSummary: "1 of 3 done \u00b7 1 in build \u00b7 1 waiting",
    ...overrides,
  };
}

describe("BuildStudio active-build header layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the intake around the operator's outcome", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );
    expect(html).toContain("Start a new outcome");
    expect(html).toContain("What outcome do you want?");
    expect(html).not.toContain(">New<");
  });

  it("files a portfolio-attributed backlog item before promotion from the Build Studio sidebar", async () => {
    backlogBuildMocks.createBuildStudioBacklogIntake.mockResolvedValueOnce({
      status: "created",
      item: {
        itemId: "BI-NEW1234",
        title: "Improve customer onboarding",
        portfolioId: "portfolio-foundational",
        portfolioName: "Foundational",
      },
    });

    render(
      <BuildStudio
        builds={[]}
        portfolios={[{ id: "portfolio-foundational", slug: "foundational", name: "Foundational" }]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Describe what should be different/i), {
      target: { value: "Improve customer onboarding" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(backlogBuildMocks.createBuildStudioBacklogIntake).toHaveBeenCalledWith({
        title: "Improve customer onboarding",
        portfolioId: "portfolio-foundational",
      });
    });
    expect(await screen.findByText("Improve customer onboarding")).toBeTruthy();
    expect(screen.queryByText("BI-NEW1234")).toBeNull();
    expect(screen.getByRole("button", { name: "Start governed build" })).toBeTruthy();
    expect(backlogBuildMocks.startBacklogBuild).not.toHaveBeenCalled();
  });

  it("renders the empty state instead of crashing when server data arrays are missing", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={undefined as unknown as FeatureBuildRow[]}
        portfolios={undefined as unknown as []}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain("What should be different?");
    expect(html).toContain("No builds yet");
    expect(html).toContain("Describe the outcome above");
    expect(html).not.toContain("Start a new build");
  });

  it("renders execution epics as fleet rows even when their child builds are no longer flat rows", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[]}
        epicRollups={[makeEpicRollup()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain("Truck stock tracker");
    expect(html).toContain("1 of 3 done");
    expect(html).toContain("2 backlog items");
    expect(html).not.toContain("No builds yet");
    expect(html).not.toContain("Low-stock surfacing");
  });

  it("keeps the active outcome in a bounded readable lane", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain('data-testid="build-studio-operator-outcome"');
    expect(html).toContain("max-w-4xl");
    expect(html).not.toMatch(/dpf\/fb8783b9\//);
  });

  it("opens the build requested by the buildId deep link", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[
          makeBuild({ buildId: "FB-FIRST", title: "First build" }),
          makeBuild({ buildId: "FB-SECOND", title: "Backlog launched build" }),
        ]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
        initialBuildId="FB-SECOND"
      />,
    );

    expect(html).toContain("Backlog launched build");
    expect(html).not.toContain(">First build</h2>");
  });

  it("URL-backs the selected default build when /build has no buildId", async () => {
    routerMocks.replace.mockClear();

    render(
      <BuildStudio
        builds={[makeBuild({ buildId: "FB-DEFAULT", title: "Default build" })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalledWith("/build?buildId=FB-DEFAULT", { scroll: false });
    });
  });

  it("bounds the active-build title so long work names cannot take over the canvas", () => {
    const longTitle = "Investigate and repair disconnected Build Studio current work surfaces with a very long backlog-derived title that used to consume the entire header";
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild({ title: longTitle })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain(longTitle);
    expect(html).toContain("text-balance");
    expect(html).toContain("max-w-4xl");
  });

  it("hides submission branch plumbing behind Technical details", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).toContain(">Technical details<");
    expect(html).not.toMatch(/dpf\/fb8783b9\//);
  });

  it("does not mount engineering or evidence surfaces before Technical details opens", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).not.toMatch(/role="tablist"[^>]*aria-label="Workflow view tabs"/);
    expect(html).toContain('data-testid="build-studio-engineer-view-toggle"');
    expect(html).not.toContain('data-testid="build-studio-technical-details"');
    expect(html).not.toContain('data-testid="build-studio-graph-panel"');
    expect(html).not.toContain('data-testid="code-intelligence-status-card"');
    expect(html).not.toContain('data-testid="process-graph"');
    expect(html).not.toContain('data-testid="build-studio-details-drawer-pill"');
    expect(html).not.toContain('data-testid="build-studio-details-drawer"');
  });

  it("presents one outcome, one status, one next action, and one activity story before technical details", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild({ phase: "review" })]}
        portfolios={[]}
        governedBacklogEnabled
        canManageGovernedWork
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
        customerStatuses={{
          "build-row-1": {
            whatIsBeingBuilt: "Fix Build Studio header/content overlap in workflow view",
            lifecyclePosition: "Checking the work",
            worker: "Build Studio",
            evidence: "Implementation finished and verification evidence is arriving.",
            nextAction: "No action needed while checks run.",
            owner: "Build Studio",
            needsYou: false,
          },
        }}
      />,
    );

    expect(html).toContain('data-testid="build-studio-operator-outcome"');
    expect(html).toContain('data-testid="build-studio-operator-status"');
    expect(html).toContain('data-testid="build-studio-operator-next-action"');
    expect(html).toContain('data-testid="build-studio-activity-story"');
    expect(html).toContain(">Technical details<");
    expect(html).not.toContain(">Engineer view<");
    expect(html).not.toContain(">Work Control<");
    expect(html).not.toContain('data-testid="process-graph"');
  });

  it("renders the build assurance gate next to code intelligence (engineer view)", async () => {
    // These engineer-grade surfaces live behind the "Engineer view" toggle after
    // the reframe (BI-90670010); render with it enabled to verify them.
    window.localStorage.setItem("dpf:build-studio-engineer-view", "true");
    const { findByTestId } = render(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    const assuranceGate = await findByTestId("build-assurance-gate-card");
    expect(assuranceGate.textContent).toContain("Assurance Gate");
    expect(assuranceGate.textContent).toContain("No BOM generated");
  });

  it("renders the portal context strip when a server envelope is provided", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
        portalContext={makePortalContextEnvelope()}
      />,
    );

    expect(html).toContain("Build context");
    expect(html).toContain("Build Studio");
    expect(html).toContain("Portal overlay");
    expect(html).not.toContain("WC-123");
  });

  it("renders a studio approval control for backlog-linked builds that are missing start approval", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled={false}
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    // The legacy "Build Status" heading + "Review with coworker" secondary
    // button are gone — BuildStudio now renders the compact ActionBanner
    // for the active workflow action (T8 + T9). The primary action label
    // ("Record Approve Start") still appears as the banner's primary button.
    expect(html).toContain('data-testid="build-studio-action-banner"');
    expect(html).toContain("Record Approve Start");
    // Banner exposes its current state via data-state — approve-start is "ready".
    expect(html).toMatch(/data-state="ready"/);
    // Legacy chrome explicitly absent.
    expect(html).not.toContain(">Build Status<");
    expect(html).not.toContain(">Review with coworker<");
  });

  it("presents the requested outcome without canonical-record terminology", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain(">Outcome<");
    expect(html).toContain("A real keeper bugfix for the governed Build Studio flow.");
    expect(html).not.toContain("Canonical backlog item");
    expect(html).not.toContain("Triage:");
    expect(html).not.toContain("Decision:");
  });

  it("shows only focus work in the operator fleet and parks quiet research/design builds under coworker custody", () => {
    const parkedBuilds = Array.from({ length: 5 }, (_, index) =>
      makeBuild({
        id: `parked-row-${index + 1}`,
        buildId: `FB-PARKED-${index + 1}`,
        title: `Parked research build ${index + 1}`,
        phase: "ideate",
        originator: null,
      }),
    );
    const builds = [
      makeBuild({
        id: "focus-row",
        buildId: "FB-FOCUS",
        title: "Review customer entry gate",
        phase: "review",
        // A genuinely-working build has a fresh heartbeat; without it the
        // stall check (BI-46204009) correctly reclassifies a build/review build
        // with a stale updatedAt as "Needs you", not "Working".
        updatedAt: new Date(),
        originator: null,
      }),
      makeBuild({
        id: "working-row",
        buildId: "FB-WORKING",
        title: "Ship provider readiness check",
        phase: "build",
        buildExecState: { step: "code_generated" } as unknown as FeatureBuildRow["buildExecState"],
        updatedAt: new Date(),
        originator: null,
      }),
      makeBuild({
        id: "needs-row",
        buildId: "FB-NEEDS-YOU",
        title: "Choose recovery path for failed review",
        phase: "plan",
        planReview: { decision: "fail" } as unknown as FeatureBuildRow["planReview"],
        originator: null,
      }),
      ...parkedBuilds,
    ];

    const html = renderToStaticMarkup(
      <BuildStudio
        builds={builds}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain(">Builds<");
    expect(html).toContain("1 needs you");
    expect(html).not.toContain("Coworker:");
    expect(html).not.toContain("Parked:");
    expect(html).not.toContain("WIP slots");
    expect(html).toContain("Review customer entry gate");
    expect(html).toContain("Ship provider readiness check");
    expect(html).toContain("Choose recovery path for failed review");
    expect(html).not.toContain("Parked research build 1");
    expect(html).not.toContain("Parked research build 5");
    expect(html).not.toContain("AI Coworker is watching 5 parked builds");
    expect(html).not.toContain("Show 5 more builds");
  });

  it("renders an implementation control once the plan is approved and start approval is recorded", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild({
          phase: "plan",
          draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
          buildPlan: {
            fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Surface workflow actions." }],
            tasks: [{ title: "Add workflow actions", testFirst: "Add failing tests.", implement: "Render the action card.", verify: "Run the verification gate." }],
          },
          planReview: {
            decision: "pass",
            summary: "Ready to implement.",
            issues: [],
          },
          happyPathState: normalizeHappyPathState({
            intake: {
              status: "ready",
              taxonomyNodeId: "capability-build-studio",
              backlogItemId: "BI-5B839D74",
              epicId: "EP-BUILD-STUDIO-UX",
              constrainedGoal: "Fix Build Studio header/content overlap in workflow view.",
            },
          }),
        })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    // Legacy card's "Ready for Implementation" heading and "Refine the plan"
    // secondary button are gone — compact ActionBanner shows the action's
    // sentence + primary button only. "Start Implementation" remains as the
    // banner's primary action label.
    expect(html).toContain('data-testid="build-studio-action-banner"');
    expect(html).toContain("Start Implementation");
    // Ready intake keeps the banner focused on one next action.
    expect(html).not.toContain('data-testid="action-banner-detail"');
  });

  it("replaces the compact banner with custodian help when review recovery would otherwise look inert", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild({
          phase: "review",
          draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
          buildPlan: {
            fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Surface proactive help." }],
            tasks: [{ title: "Add proactive help", testFirst: "Add tests.", implement: "Render the prompt.", verify: "Run checks." }],
          },
          planReview: {
            decision: "pass",
            summary: "Ready to review.",
            issues: [],
          },
          uxVerificationStatus: "failed",
          uxTestResults: [{ step: "Open the build", passed: false, screenshotUrl: null, error: "No evidence captured." }],
        })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain('data-testid="build-studio-custodian-callout"');
    expect(html).toContain("I can collect what is missing.");
    expect(html.match(/Finish review with coworker/g)).toHaveLength(1);
    expect(html).not.toContain('data-testid="build-studio-action-banner"');
  });

  it("mounts the footer OpenSandboxButton — single shared sandbox link", () => {
    // Footer surfaces the shared sandbox without resorting to a per-build
    // Preview tab. When a build has a live sandboxPort, the footer button
    // labels itself with the driving build code.
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild({
          phase: "build",
          sandboxPort: 5555,
          draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );
    expect(html).toContain('data-testid="build-studio-footer"');
    expect(html).toContain('data-testid="build-studio-open-sandbox"');
    expect(html).toContain('data-driving="FB-9B19098C"');
    expect(html).toContain("Open live preview · current build");
    expect(html).not.toContain("driving: FB-9B19098C");
    expect(html).toContain('href="http://localhost:5555"');
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it("footer OpenSandboxButton shows 'idle' when no build has a live sandboxPort", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild({ phase: "ideate", sandboxPort: null })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );
    expect(html).toContain('data-testid="build-studio-open-sandbox"');
    expect(html).toContain('data-driving="idle"');
    // Disabled span renders (no anchor when sandboxUrl is empty).
    expect(html).toContain('aria-disabled="true"');
  });

  it("removes the per-build Preview tab from the tab selector", () => {
    // Per spec §1: per-build Preview is dishonest (sandbox is shared).
    // The footer OpenSandboxButton handles the shared link instead.
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild({
          phase: "build",
          sandboxPort: 5555,
          draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
        })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );
    // No tab with the Preview label.
    expect(html).not.toMatch(/<button[^>]*role="tab"[^>]*>Preview<\/button>/);
    // The aria-controls pointing at "panel-preview" must not exist.
    expect(html).not.toContain('aria-controls="panel-preview"');
  });

  it("renders the dedicated release decision surface when a build reaches ship", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild({
          phase: "ship",
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
        })]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain("release-decision-panel");
    expect(html).toContain("Preparing for release");
  });
});

describe("BuildStudio progressive technical disclosure", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the outcome while hiding technical identifiers by default", () => {
    const { getAllByText, queryByTestId, getByRole } = render(
      <BuildStudio
        builds={[makeBuild({ buildId: "FB-DALE01" })]}
        epicRollups={[]}
        portfolios={[]}
        governedBacklogEnabled
        portalContext={makePortalContextEnvelope()}
        projectBranch="main"
        submissionBranchShortId="aabbccdd"
      />,
    );
    const titleElements = getAllByText("Fix Build Studio header/content overlap in workflow view");
    expect(titleElements.length).toBeGreaterThan(0);
    const btn = getByRole("button", { name: "Technical details" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(queryByTestId("build-studio-build-id")).toBeNull();
    expect(queryByTestId("build-studio-header-details")).toBeNull();
  });

  it("reveals IDs, branch, and evidence only after Technical details opens", async () => {
    const { getByRole, findByTestId, queryByTestId } = render(
      <BuildStudio
        builds={[makeBuild({ buildId: "FB-DALE02" })]}
        epicRollups={[]}
        portfolios={[]}
        governedBacklogEnabled
        portalContext={makePortalContextEnvelope()}
        projectBranch="main"
        submissionBranchShortId="aabbccdd"
      />,
    );
    const detailsBtn = getByRole("button", { name: "Technical details" });
    expect(detailsBtn.getAttribute("aria-expanded")).toBe("false");

    detailsBtn.click();

    const details = await findByTestId("build-studio-header-details");
    expect(details).toBeDefined();
    expect(details.textContent).toContain("FB-DALE02");
    expect(details.textContent).toContain("BI-5B839D74");
    expect(details.textContent).toContain("dpf/aabbccdd/");
    expect(queryByTestId("build-studio-build-id")).not.toBeNull();
  });

  it("collapses the complete technical region with the same control", async () => {
    const { getByRole, queryByTestId } = render(
      <BuildStudio
        builds={[makeBuild({ buildId: "FB-DALE03" })]}
        epicRollups={[]}
        portfolios={[]}
        governedBacklogEnabled
        portalContext={makePortalContextEnvelope()}
        projectBranch="main"
        submissionBranchShortId="aabbccdd"
      />,
    );
    const btn = getByRole("button", { name: "Technical details" });
    btn.click();
    await waitFor(() => expect(queryByTestId("build-studio-technical-details")).not.toBeNull());
    const closeButton = getByRole("button", { name: "Hide technical details" });
    closeButton.click();
    await waitFor(() => expect(queryByTestId("build-studio-technical-details")).toBeNull());
  });

  it("persists the technical user's disclosure preference", async () => {
    const { getByRole } = render(
      <BuildStudio
        builds={[makeBuild()]}
        epicRollups={[]}
        portfolios={[]}
        governedBacklogEnabled
        portalContext={makePortalContextEnvelope()}
        projectBranch="main"
        submissionBranchShortId="aabbccdd"
      />,
    );
    getByRole("button", { name: "Technical details" }).click();
    await waitFor(() =>
      expect(localStorage.getItem("dpf:build-studio-engineer-view")).toBe("true"),
    );
  });

  it("restores Technical details when a technical user opted in previously", async () => {
    localStorage.setItem("dpf:build-studio-engineer-view", "true");
    const { findByTestId } = render(
      <BuildStudio
        builds={[makeBuild({ buildId: "FB-RESTORED" })]}
        epicRollups={[]}
        portfolios={[]}
        governedBacklogEnabled
        portalContext={makePortalContextEnvelope()}
        projectBranch="main"
        submissionBranchShortId="aabbccdd"
      />,
    );
    const details = await findByTestId("build-studio-header-details");
    expect(details.textContent).toContain("FB-RESTORED");
  });

  it("keeps WorkWarrant governance in Technical details", async () => {
    localStorage.setItem("dpf:build-studio-engineer-view", "true");
    const { findByTestId } = render(
      <BuildStudio
        builds={[
          makeBuild({
            plan: {
              workWarrant: {
                altitude: "WWMD",
                altitudeBasis: "structural",
                confidence: "high",
                needsOperatorConfirm: false,
                lane: "governed-interactive",
                budget: {
                  modelTier: "strong",
                  effortLevel: "high",
                  gateProfile: "full",
                  tokenCeiling: null,
                },
                evidenceProfile: "architectural",
                reportingProfile: "ledger",
                contextScope: {
                  industry: null,
                  jurisdiction: null,
                  archetype: null,
                },
                reasons: ["touches a cross-cutting platform contract"],
              },
            },
          }),
        ]}
        epicRollups={[]}
        portfolios={[]}
        governedBacklogEnabled
        portalContext={makePortalContextEnvelope()}
        projectBranch="main"
        submissionBranchShortId="aabbccdd"
      />,
    );

    const warrant = await findByTestId("build-work-warrant-band");
    expect(warrant.textContent).toContain("Architecture-level work");
    expect(warrant.textContent).toContain("governed review");
    expect(warrant.textContent).toContain("strong model");
    expect(warrant.textContent).toContain("ledger evidence");
  });
});

function makePortalContextEnvelope(): PortalContextEnvelope {
  return {
    envelopeId: "env-1",
    resolvedAt: "2026-05-17T18:23:30.000Z",
    route: { pathname: "/build", routeContext: "/build", domain: "Build Studio", sensitivity: "internal", docsPath: null },
    organization: { organizationId: "ORG-1", name: "Digital Product Factory", archetypeId: "software-platform-operator" },
    user: { userId: "user-1", principalId: "principal-1", platformRole: "HR-000" },
    anchors: [],
    work: {
      backlogItem: null,
      epic: null,
      capsule: {
        capsuleId: "WC-123",
        title: "Portal overlay",
        status: "working",
        executorKind: "build-studio",
        executorRef: null,
        leaseHolderPrincipalId: null,
        leaseExpiresAt: null,
        isLeaseExpired: false,
        isStale: false,
        scopeClaims: [],
        scopeClaimPrincipalIds: [],
        branchName: "feat/portal-context-overlay-hive-mind",
        href: "/build/work/WC-123",
      },
      featureBuild: null,
      taskRun: null,
      agentThread: null,
      branch: null,
    },
    evidence: [],
    authority: {
      canActOnCapsule: true,
      canActOnBuild: true,
      canReviewPromotion: true,
      grantedToolKeys: [],
      proposalModeActive: true,
    },
    coworkers: [],
    attention: [],
    capability: null,
    promptDigest: "Route: /build",
  };
}
