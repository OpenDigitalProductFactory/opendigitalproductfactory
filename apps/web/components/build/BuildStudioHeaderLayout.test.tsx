import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildStudio } from "@/components/build/BuildStudio";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/actions/build", () => ({
  approveBuildStart: vi.fn(),
  advanceBuildPhase: vi.fn(),
  createFeatureBuild: vi.fn(),
  deleteFeatureBuild: vi.fn(),
  retryBuildExecution: vi.fn(),
}));

vi.mock("@/lib/actions/build-read", () => ({
  getFeatureBuild: vi.fn(),
}));

vi.mock("@/lib/actions/build-flow", () => ({
  getBuildFlowStateAction: vi.fn(),
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

    expect(html).toContain("Studio Control");
    expect(html).toContain("Record Approve Start");
    expect(html).toContain("Review with coworker");
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

    expect(html).toContain("Ready for Implementation");
    expect(html).toContain("Start Implementation");
    expect(html).toContain("Refine the plan");
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
