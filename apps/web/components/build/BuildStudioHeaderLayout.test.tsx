// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildStudio } from "@/components/build/BuildStudio";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";
import type { PortalContextEnvelope } from "@/lib/portal-context";

const routerMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
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

vi.mock("@/lib/actions/build-read", () => ({
  getFeatureBuild: vi.fn(),
}));

vi.mock("@/lib/actions/build-flow", () => ({
  getBuildFlowStateAction: vi.fn(),
}));

vi.mock("@/lib/actions/build-progress-visibility", () => ({
  getBuildProgressVisibilityAction: vi.fn(),
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

describe("BuildStudio active-build header layout", () => {
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

    expect(html).toContain("Product Development Studio");
    expect(html).toContain("No builds yet");
  });

  it("keeps the active-build title and metadata lane shrinkable for long submission branches", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toMatch(/<div class=\"min-w-0 flex-1\">/);
    expect(html).toMatch(/class=\"mt-1 flex flex-wrap items-center gap-2 text-xs text-\[var\(--dpf-muted\)\]\"/);
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
    expect(html).not.toContain("First build</h2>");
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

    expect(html).toContain(`title="${longTitle}"`);
    expect(html).toMatch(/class=\"m-0 max-h-\[3rem\] min-w-0 overflow-hidden break-words text-base font-bold leading-6 text-\[var\(--dpf-text\)\] line-clamp-2\"/);
  });

  it("renders the submission branch badge in a truncating wrapper instead of an unconstrained inline chip", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toMatch(/class=\"inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-\[var\(--dpf-border\)\] bg-\[var\(--dpf-surface-2\)\] px-1\.5 py-0\.5 font-mono\"/);
    expect(html).toMatch(/class=\"truncate\">dpf\/fb8783b9\/fix-build-studio-header-content-overlap-in-workflo/);
  });

  it("defaults to the operational progress view and keeps topology available", () => {
    const html = renderToStaticMarkup(
      <BuildStudio
        builds={[makeBuild()]}
        portfolios={[]}
        governedBacklogEnabled
        projectBranch="main"
        submissionBranchShortId="fb8783b9"
      />,
    );

    expect(html).toContain(">Progress<");
    expect(html).toContain(">Workflow<");
    expect(html).toContain("Loading build progress...");
    expect(html).not.toContain("code-intelligence-status-card");
    expect(html).not.toContain("process-graph");
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

    expect(html).toContain("Portal context");
    expect(html).toContain("Build Studio");
    expect(html).toContain("WC-123");
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
    // Detail line surfaces the intake-incomplete reason (banner shows detail
    // only when state ∈ {blocked, review_failed}, which intake-missing maps to).
    expect(html).toContain('data-testid="action-banner-detail"');
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
    expect(html).toContain(">Release<");
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
    promptDigest: "Route: /build",
  };
}
