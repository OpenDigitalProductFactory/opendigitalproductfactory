import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildListItem } from "@/components/build/BuildListItem";
import { BUILD_STUDIO_TEST_IDS } from "@/components/build/build-studio-layout";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "build-row-1",
    buildId: "FB-9B19098C",
    title: "Fix Build Studio current work layout",
    description: "Keep current work scannable while work is in progress.",
    portfolioId: null,
    originatingBacklogItemId: "backlog-row-1",
    brief: null,
    plan: null,
    phase: "build",
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
    updatedAt: new Date("2026-04-25T14:30:00Z"),
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
      title: "Fix Build Studio current work layout",
      status: "in-progress",
      triageOutcome: "build",
      effortSize: "small",
      proposedOutcome: null,
      activeBuildId: "build-row-1",
      resolution: null,
      abandonReason: null,
    },
    phaseHandoffs: [],
    ...overrides,
  };
}

describe("BuildListItem", () => {
  it("renders a bounded, accessible current-work row", () => {
    const title = "Repair disconnected Build Studio current work surface with an intentionally long title that should not dominate the sidebar";
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild({ title })}
        active
        index={2}
        lifecycleLabel="In build"
        isDevEnvironment={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain(`data-testid="${BUILD_STUDIO_TEST_IDS.buildListItem}"`);
    expect(html).toContain(`title="${title}"`);
    expect(html).toContain(`aria-label="Open build ${title}"`);
    expect(html).toMatch(/class=\"line-clamp-2 max-h-\[2\.5rem\] min-w-0 overflow-hidden break-words text-sm font-semibold leading-5 text-\[var\(--dpf-text\)\]\"/);
    expect(html).toContain("min-h-[88px]");
    expect(html).toContain("max-h-[128px]");
    expect(html).toContain("Updated Apr 25");
    expect(html).toContain("In build");
  });

  it("keeps delete as a separate control instead of nesting it inside the select button", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Open build Fix Build Studio current work layout"');
    expect(html).toContain('aria-label="Delete Fix Build Studio current work layout"');
    const openControlStart = html.indexOf('aria-label="Open build Fix Build Studio current work layout"');
    const deleteControlStart = html.indexOf('aria-label="Delete Fix Build Studio current work layout"');
    expect(openControlStart).toBeGreaterThan(-1);
    expect(deleteControlStart).toBeGreaterThan(openControlStart);
    expect(html.slice(openControlStart, deleteControlStart)).toContain("</button>");
  });
});

describe("BuildListItem fleet density", () => {
  it("uses the reconciled owner state for the selected row instead of a contradictory queue label", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        queueState={{ kind: "running", stepLabel: null }}
        attention={{ state: "not-started", reason: null, needsOwner: false, fromRuntimeSignal: false }}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain("Preparing");
    expect(html).not.toContain(">Working<");
  });

  it("renders the compact fleet row instead of the comfortable card", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain('data-density="fleet"');
    expect(html).toContain("fleet-row");
    // Fleet density must NOT use the comfortable min/max-h tokens.
    expect(html).not.toContain("min-h-[88px]");
    expect(html).not.toContain("max-h-[128px]");
  });

  it("uses the ≤32px row height class from the layout helper (no pixel assertion)", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // Class assertion only — jsdom can't measure layout reliably.
    expect(html).toContain("max-h-8");
    expect(html).toContain("min-h-8");
  });

  it("does NOT render the 'Updated MMM DD' chrome at fleet density", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).not.toContain("Updated Apr");
  });

  it("renders a plain work status label instead of an unlabeled phase dot rail", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="fleet-row-status"');
    expect(html).toContain("Building");
    expect(html).not.toContain(BUILD_STUDIO_TEST_IDS.phaseMiniRail);
    expect(html).not.toContain("Active: build");
  });

  it("renders queued state as plain text when queueState is not idle", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        queueState={{ kind: "queued", position: 3, reason: "capacity", ahead: 2 }}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="fleet-row-status"');
    expect(html).toContain("Waiting");
    expect(html).not.toContain('aria-label="Queued, position 3"');
    expect(html).not.toContain('data-kind="queued"');
  });

  it("omits the QueueStateBadge when queueState is 'idle' (or missing)", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // No badge rendered for idle / undefined queueState.
    expect(html).not.toContain('data-kind="running"');
    expect(html).not.toContain('data-kind="queued"');
    expect(html).not.toContain('data-kind="blocked"');
  });

  it("renders needs-attention as a plain operator status, not a standalone dot", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        attention={{ state: "waiting-owner", reason: "Ready for your release decision.", needsOwner: true, fromRuntimeSignal: true }}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="fleet-row-status"');
    expect(html).toContain("Needs you");
    expect(html).not.toContain('data-testid="fleet-row-attention"');
    expect(html).not.toContain('aria-label="Needs attention"');
  });

  it("omits the needs-you status when no attention is supplied (default)", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).not.toContain("Needs you");
  });

  it("uses 4px left-border accent + aria-current for the active row (not just color)", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain("border-l-4");
    expect(html).toContain("border-[var(--dpf-accent)]");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('data-active="true"');
  });

  it("inactive row uses transparent border (not aria-current)", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain("border-transparent");
    expect(html).not.toContain('aria-current="true"');
  });

  it("hides FB-* and BI-* codes by default at fleet density", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).not.toContain("FB-9B19098C");
    expect(html).not.toContain("BI-5B839D74");
    expect(html).not.toMatch(/title="BI-/);
  });

  it("delete button is icon-only and hidden by default at fleet density", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="fleet-row-delete"');
    expect(html).toContain("hidden"); // hidden until hover/focus
    expect(html).toContain("group-hover:flex");
  });

  it("renders the FleetDensityBar during the build phase when a plan is attached", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild({
          phase: "build",
          buildPlan: {
            fileStructure: [],
            tasks: [
              { title: "T1", testFirst: "", implement: "", verify: "" },
              { title: "T2", testFirst: "", implement: "", verify: "" },
              { title: "T3", testFirst: "", implement: "", verify: "" },
              { title: "T4", testFirst: "", implement: "", verify: "" },
            ],
          },
          taskResults: [
            { taskIndex: 0, title: "T1", testResult: { passed: true, output: "" }, codeReview: { issues: [] } as never },
          ],
        })}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="fleet-density-bar"');
    expect(html).toContain('aria-label="Tasks: 1 of 4 done"');
  });

  it("does NOT render the FleetDensityBar outside the build phase", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild({
          phase: "review",
          buildPlan: {
            fileStructure: [],
            tasks: [
              { title: "T1", testFirst: "", implement: "", verify: "" },
              { title: "T2", testFirst: "", implement: "", verify: "" },
            ],
          },
          taskResults: [
            { taskIndex: 0, title: "T1", testResult: { passed: true, output: "" }, codeReview: { issues: [] } as never },
          ],
        })}
        active={false}
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).not.toContain('data-testid="fleet-density-bar"');
  });

  it("renders no hex literals at fleet density (DPF variable invariant)", () => {
    const html = renderToStaticMarkup(
      <BuildListItem
        build={makeBuild()}
        active
        index={0}
        lifecycleLabel={null}
        isDevEnvironment={false}
        density="fleet"
        queueState={{ kind: "running", stepLabel: "Generate" }}
        attention={{ state: "waiting-owner", reason: "Ready for your release decision.", needsOwner: true, fromRuntimeSignal: true }}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
