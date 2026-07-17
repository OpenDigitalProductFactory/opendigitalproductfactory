// @vitest-environment jsdom
//
// Regression guard for the "What's in this update?" self-upgrade panel.
//
// The "show more" disclosure used to render the FULL `allItems` list, which
// includes the top-N rows already shown above it — so expanding repeated the
// truncated list instead of extending it. The disclosure must reveal ONLY the
// items not already shown, so each change appears exactly once.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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

  it("shows only the top-N rows while collapsed, tail hidden", () => {
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(top, all)} />);

    // Collapsed: the preview (top-N) is shown; the tail is not yet in the DOM
    // (the CollapsibleList primitive slices hidden rows out until expanded).
    expect(screen.getAllByText("Top change one")).toHaveLength(1);
    expect(screen.getAllByText("Top change two")).toHaveLength(1);
    expect(screen.queryByText("Tail change three")).toBeNull();
    expect(screen.queryByText("Tail change four")).toBeNull();
  });

  it("labels the disclosure with the remaining count, not the full count", () => {
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(top, all)} />);

    // 4 total, 2 shown up top -> 2 remaining behind the fold.
    expect(screen.getByText("Show 2 more changes")).toBeTruthy();
    expect(screen.queryByText("Show all 4 changes")).toBeNull();
  });

  it("flips the label when expanded and keeps every change unduplicated", () => {
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(top, all)} />);

    // The toggle is a real button at the FOOT of the list (not a mid-list
    // <details> summary) — click it to reveal the tail.
    fireEvent.click(screen.getByText("Show 2 more changes"));

    expect(screen.getByText("Show fewer")).toBeTruthy();
    // Expanded view shows each change exactly once — top-N never re-rendered
    // (remainingItems is allItems minus the top-N by SHA).
    expect(screen.getAllByText("Top change one")).toHaveLength(1);
    expect(screen.getAllByText("Top change two")).toHaveLength(1);
    expect(screen.getAllByText("Tail change three")).toHaveLength(1);
    expect(screen.getAllByText("Tail change four")).toHaveLength(1);
  });

  it("omits the disclosure entirely when nothing exceeds the top-N", () => {
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(top, top)} />);

    expect(screen.queryByText(/more change/)).toBeNull();
    expect(screen.queryByText("Show fewer")).toBeNull();
    expect(screen.getAllByText("Top change one")).toHaveLength(1);
  });
});

// BI-4A400DE4: the git-walk + LLM impact summary used to be generated
// SYNCHRONOUSLY in the server render (page.tsx `await summarizeUpgradeImpact()`),
// blocking the whole /ops/self-upgrade page 30-60s on the first view after each
// upgrade (target changes every upgrade → cache miss). It now generates CLIENT-
// side on mount so the page paints immediately; these guard that move.
describe("UpgradeImpactPanel — auto-generate on first view (BI-4A400DE4)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const one = [item("s1", "Change one")];

  it("auto-fetches the summary on mount when enabled and the page shipped no cache", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summaryWith(one, one) });
    render(<UpgradeImpactPanel enabled initialSummary={null} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/ops/self-upgrade/impact-summary");
    // the fetched summary renders without a click
    await waitFor(() => expect(screen.getByText("Change one")).toBeTruthy());
  });

  it("does NOT auto-fetch when the server already provided a cached summary", async () => {
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(one, one)} />);
    await new Promise((r) => setTimeout(r, 25));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT auto-fetch (and renders nothing) when there is no update to summarize", async () => {
    const { container } = render(<UpgradeImpactPanel enabled={false} initialSummary={null} />);
    await new Promise((r) => setTimeout(r, 25));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });
});

describe("UpgradeImpactPanel — activity indication", () => {
  const top = [item("sha1", "Top change one"), item("sha2", "Top change two")];
  const all = [...top, item("sha3", "Tail change three")];

  afterEach(() => vi.unstubAllGlobals());

  it("shows an inline busy label and a panel skeleton while auto-generating on first view", async () => {
    // No initialSummary → the panel auto-fetches on mount (BI-4A400DE4). A
    // never-resolving fetch keeps the useTransition pending so the loading UI
    // stays on screen — no click needed, the activity shows behind the fetch.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<UpgradeImpactPanel enabled />);

    // Trigger shows the inline busy affordance (spinner + live label)...
    expect(await screen.findByText("Summarizing…")).toBeTruthy();
    // ...and the panel renders a shape-of-content skeleton in a busy region.
    const loading = document.querySelector('[data-summary-state="loading"]');
    expect(loading).toBeTruthy();
    expect(loading?.closest('[aria-busy="true"]')).toBeTruthy();
  });

  it("keeps the existing summary visible and marked busy while refreshing", async () => {
    // With a cached summary there is no auto-fetch; the Refresh button drives it.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<UpgradeImpactPanel enabled initialSummary={summaryWith(top, all)} />);

    fireEvent.click(screen.getByText("Refresh"));

    expect(await screen.findByText("Summarizing…")).toBeTruthy();
    // No skeleton swap — prior content stays put, just dimmed and marked busy.
    expect(document.querySelector('[data-summary-state="loading"]')).toBeNull();
    expect(screen.getAllByText("Top change one")).toHaveLength(1);
    const okRegion = document.querySelector('[data-summary-state="ok"]');
    expect(okRegion?.getAttribute("aria-busy")).toBe("true");
  });
});
