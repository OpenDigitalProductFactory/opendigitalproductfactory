// @vitest-environment jsdom
//
// Regression guard for the "What's in this update?" self-upgrade panel.
//
// The "show more" disclosure used to render the FULL `allItems` list, which
// includes the top-N rows already shown above it — so expanding repeated the
// truncated list instead of extending it. The disclosure must reveal ONLY the
// items not already shown, so each change appears exactly once.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type {
  ChangeCategory,
  ImpactItem,
  SummaryResult,
  UpgradeImpactSummary,
} from "@/lib/self-upgrade/impact/types";
import UpgradeImpactPanel from "./UpgradeImpactPanel";

afterEach(() => cleanup());

function item(
  sha: string,
  description: string,
  category: ChangeCategory = "feature",
): ImpactItem {
  return {
    sha,
    description,
    type: "feat",
    scope: null,
    category,
    breaking: false,
    prNumber: null,
    prTitle: null,
    prLabels: [],
    score: 0,
    reasons: [],
    touchesCustomizations: false,
  };
}

function summaryWith(
  topItems: ImpactItem[],
  allItems: ImpactItem[],
): SummaryResult {
  const summary: UpgradeImpactSummary = {
    currentLineageSha: "a".repeat(40),
    targetSha: "b".repeat(40),
    counts: {
      breaking: 0,
      feature: allItems.length,
      fix: 0,
      performance: 0,
      other: 0,
      total: allItems.length,
    },
    topItems,
    allItems,
    phrased: null,
    enrichment: { githubReachable: true, prsEnriched: 0 },
    generatedAt: "2026-06-16T00:00:00.000Z",
    fromCache: true,
  };
  return { ok: true, summary };
}

describe("UpgradeImpactPanel — show-more disclosure", () => {
  const top = [item("sha1", "Top change one"), item("sha2", "Top change two")];
  const all = [
    ...top,
    item("sha3", "Tail change three"),
    item("sha4", "Tail change four"),
  ];

  it("does not duplicate the top-N rows when the full list is available", () => {
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(top, all)} />);

    // Each change — top-N and tail alike — must appear exactly once. Before the
    // fix, the top-N rows rendered twice (once in the top list, once inside the
    // disclosure that re-rendered the whole `allItems`).
    expect(screen.getAllByText("Top change one")).toHaveLength(1);
    expect(screen.getAllByText("Top change two")).toHaveLength(1);
    expect(screen.getAllByText("Tail change three")).toHaveLength(1);
    expect(screen.getAllByText("Tail change four")).toHaveLength(1);
  });

  it("labels the disclosure with the remaining count, not the full count", () => {
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(top, all)} />);

    // 4 total, 2 shown up top -> 2 remaining behind the fold.
    expect(screen.getByText("Show 2 more changes")).toBeTruthy();
    expect(screen.queryByText("Show all 4 changes")).toBeNull();
  });

  it("flips the label when expanded and keeps rows unduplicated", () => {
    const { container } = render(
      <UpgradeImpactPanel enabled initialSummary={summaryWith(top, all)} />,
    );

    // jsdom doesn't toggle <details open> or fire `toggle` from a summary
    // click, so reproduce what the browser does — open the element and fire the
    // toggle event — to drive the controlled onToggle -> setShowFullList path.
    const details = container.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    expect(screen.getByText("Show fewer")).toBeTruthy();
    // Expanded view still shows each change exactly once.
    expect(screen.getAllByText("Top change one")).toHaveLength(1);
    expect(screen.getAllByText("Tail change four")).toHaveLength(1);
  });

  it("omits the disclosure entirely when nothing exceeds the top-N", () => {
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(top, top)} />);

    expect(screen.queryByText(/more change/)).toBeNull();
    expect(screen.queryByText("Show fewer")).toBeNull();
    expect(screen.getAllByText("Top change one")).toHaveLength(1);
  });
});
