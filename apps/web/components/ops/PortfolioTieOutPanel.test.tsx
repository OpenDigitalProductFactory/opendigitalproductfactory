import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/portfolio-budget", () => ({
  setPortfolioBudgetAction: vi.fn(),
  confirmEpicPortfoliosAction: vi.fn(),
}));

import type { PortfolioTieOut, TieOutRow } from "@/lib/portfolio/tie-out";

import { PortfolioTieOutPanel } from "./PortfolioTieOutPanel";

const row = (overrides: Partial<TieOutRow>): TieOutRow => ({
  portfolioId: "p-found", name: "Foundational", budget: null,
  reservedPoints: 0, inFlightPoints: 704, deliveredPoints: 974, committedPoints: 704,
  forecast: { low: 8, median: 40, high: 122, label: "measured" },
  overCommitment: { pointsLow: 582, pointsHigh: 696, weeks: 22 },
  tracedShare: 0.121, bySurface: { "build-studio": 0, external: 106, other: 230 },
  ai: { runs: 12, tokens: 240_000, recordedUsd: null, subscriptionTokens: 240_000, durationMs: 12 * 300_000 },
  ...overrides,
});

// The shape measured live on this install on 2026-09-25.
const tieOut: PortfolioTieOut = {
  period: { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
  weeksRemaining: 0.7,
  weeksOfHistory: 6,
  untracedChanges: 100,
  aiNotTraced: { runs: 104, tokens: 1_335_886, recordedUsd: null, subscriptionTokens: 1_335_886, durationMs: 0 },
  rows: [
    row({}),
    row({ portfolioId: null, name: "Unallocated", inFlightPoints: 18, deliveredPoints: 1, committedPoints: 18, overCommitment: { pointsLow: 17, pointsHigh: 18, weeks: null }, tracedShare: 0 }),
  ],
};

describe("PortfolioTieOutPanel (BI-CBF5D708)", () => {
  const html = renderToStaticMarkup(
    <PortfolioTieOutPanel
      tieOut={tieOut}
      proposedPoints={{ "p-found": 974 }}
      unconfirmedEpics={[{ epicId: "EP-1", title: "Budgets", portfolioId: "p-found", portfolioName: "Foundational", confidence: "high" }]}
    />,
  );

  it("shows every portfolio and the unallocated row, with 'No budget set' rather than zero", () => {
    expect(html).toContain("Foundational");
    expect(html).toContain("Unallocated");
    expect(html).toContain("No budget set");
    expect(html).toContain("Set budget");
  });

  it("states over-commitment in words and numbers and the traced share on each row", () => {
    expect(html).toContain("+582 to +696 points over capacity; 22 weeks of work beyond the quarter at the current pace");
    expect(html).toContain("12% traced");
    expect(html).toContain("no delivery measured to pace it");
  });

  it("names the work it cannot see, and the epics awaiting a person's confirmation", () => {
    expect(html).toContain("100 merged change(s) in six weeks name no backlog item");
    expect(html).toContain("1 epic(s) have a proposed portfolio no person has confirmed yet");
  });

  it("puts AI tokens, spend and run time beside the points, subscription use never as zero (BI-0CA5DA2B)", () => {
    expect(html).toContain("240k tokens");
    expect(html).toContain("subscription: $0 recorded, 240k tokens");
    expect(html).toContain("12 run(s), 5 min average");
    expect(html).toContain("104 AI run(s) this quarter reach no item in these rows");
  });
});
