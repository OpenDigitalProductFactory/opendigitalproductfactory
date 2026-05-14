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
