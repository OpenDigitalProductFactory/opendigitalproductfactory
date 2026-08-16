// @vitest-environment jsdom
//
// BI-F7A591AF: a Run History row showed status + runId + a SHA pair, so the
// question asked after an upgrade goes wrong — which upgrade introduced this,
// and when? — could only be answered by reading the database. These guard the
// two properties that make the row answer it: the digest is visible without a
// click, and the item list loads lazily for the ONE run the operator expands.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const getSelfUpgradeRunImpactMock = vi.fn();
vi.mock("@/lib/actions/promotions", () => ({
  getSelfUpgradeRunImpact: (...a: unknown[]) => getSelfUpgradeRunImpactMock(...a),
}));

import { RunImpactDetail } from "./RunImpactDetail";
import type { ImpactItem, UpgradeImpactSummary } from "@/lib/self-upgrade/impact/types";

afterEach(() => {
  cleanup();
  getSelfUpgradeRunImpactMock.mockReset();
});

const DIGEST = {
  counts: {
    breaking: 0,
    security: 1,
    feature: 0,
    fix: 0,
    performance: 0,
    dependency: 2,
    documentation: 1,
    maintenance: 0,
    other: 0,
    total: 4,
  },
  headline: "One security patch, two dependency updates and a doc addition.",
};

function item(sha: string, description: string, category: ImpactItem["category"]): ImpactItem {
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

function summary(items: ImpactItem[]): UpgradeImpactSummary {
  return {
    currentLineageSha: "a".repeat(40),
    targetSha: "b".repeat(40),
    counts: DIGEST.counts,
    topItems: items,
    allItems: items,
    phrased: null,
    enrichment: { githubReachable: true, prsEnriched: 1 },
    generatedAt: "2026-08-01T00:00:00.000Z",
    fromCache: true,
  };
}

describe("RunImpactDetail", () => {
  it("shows what the run carried without a click, and fetches nothing up front", () => {
    render(<RunImpactDetail runId="SUR-AAAA0001" digest={DIGEST} />);

    expect(screen.getByText(DIGEST.headline)).toBeTruthy();
    expect(screen.getByText(/1 security · 2 dependency · 1 docs/)).toBeTruthy();
    expect(getSelfUpgradeRunImpactMock).not.toHaveBeenCalled();
  });

  it("loads the item list only when expanded, and only once", async () => {
    getSelfUpgradeRunImpactMock.mockResolvedValue(
      summary([item("s1", "Patched an advisory", "security")]),
    );
    render(<RunImpactDetail runId="SUR-AAAA0001" digest={DIGEST} />);

    fireEvent.click(screen.getByText("View changes"));

    await waitFor(() => expect(screen.getByText("Patched an advisory")).toBeTruthy());
    expect(getSelfUpgradeRunImpactMock).toHaveBeenCalledWith("SUR-AAAA0001");
    expect(screen.getByText("Security")).toBeTruthy();

    // Collapse and re-expand: the held summary is replayed, not re-fetched.
    fireEvent.click(screen.getByText("Hide changes"));
    fireEvent.click(screen.getByText("View changes"));
    await waitFor(() => expect(screen.getByText("Patched an advisory")).toBeTruthy());
    expect(getSelfUpgradeRunImpactMock).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when the recorded change list is gone", async () => {
    getSelfUpgradeRunImpactMock.mockResolvedValue(null);
    render(<RunImpactDetail runId="SUR-AAAA0001" digest={DIGEST} />);

    fireEvent.click(screen.getByText("View changes"));

    await waitFor(() =>
      expect(screen.getByText(/change list is no longer/)).toBeTruthy(),
    );
  });

  it("surfaces a load failure instead of rendering an empty list", async () => {
    getSelfUpgradeRunImpactMock.mockRejectedValue(new Error("Unauthorized"));
    render(<RunImpactDetail runId="SUR-AAAA0001" digest={DIGEST} />);

    fireEvent.click(screen.getByText("View changes"));

    await waitFor(() => expect(screen.getByText("Unauthorized")).toBeTruthy());
  });
});
