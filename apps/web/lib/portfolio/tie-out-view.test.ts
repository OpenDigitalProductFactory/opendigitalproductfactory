import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { budgetText, forecastText, overCommitmentText, tracedText } from "./tie-out-view";

describe("tie-out display rules (BI-CBF5D708, design §6)", () => {
  it("never shows a missing budget as zero", () => {
    expect(budgetText({ portfolioId: "p1", budget: null })).toBe("No budget set");
    expect(budgetText({ portfolioId: null, budget: null })).toBe("Not budgeted");
  });

  it("states over-commitment in points and in weeks, not by colour alone (AC-3)", () => {
    // Live shape on this install, 2026-09-25: Foundational.
    const over = overCommitmentText({ committedPoints: 704, overCommitment: { pointsLow: 582, pointsHigh: 696, weeks: 22 } });
    expect(over.text).toBe("+582 to +696 points over capacity; 22 weeks of work beyond the quarter at the current pace");
    expect(over.tone).toBe("danger");
  });

  it("says when the range straddles capacity, and when work fits", () => {
    expect(overCommitmentText({ committedPoints: 20, overCommitment: { pointsLow: -10, pointsHigh: 6, weeks: -1.5 } }).text)
      .toBe("Up to +6 points over, depending on pace; clears 1.5 weeks before the quarter ends at the current pace");
    expect(overCommitmentText({ committedPoints: 10, overCommitment: { pointsLow: -30, pointsHigh: -12, weeks: -4 } }))
      .toEqual({ text: "Within capacity by 12 to 30 points", tone: "success" });
  });

  it("names the missing pace instead of inventing one", () => {
    expect(overCommitmentText({ committedPoints: 18, overCommitment: { pointsLow: 17, pointsHigh: 18, weeks: null } }).text)
      .toContain("no delivery measured to pace it");
  });

  it("labels an estimated forecast and states the traced share", () => {
    expect(forecastText({ forecast: { low: 8, median: 40, high: 122, label: "measured" } })).toBe("8–122");
    expect(forecastText({ forecast: { low: 3, median: 3, high: 3, label: "estimated" } })).toBe("3 (estimated)");
    expect(tracedText({ tracedShare: 0.121 })).toBe("12% traced");
    expect(tracedText({ tracedShare: null })).toBe("Nothing delivered yet");
  });
});

describe("the tie-out panel's client imports stay off the database", () => {
  // PortfolioTieOutPanel is a client component. A value import of a module that
  // reaches @dpf/db pulls pg into the browser bundle and fails `next build`
  // (it did, in the 2026-09-26 local-CI gate), which no unit test sees.
  const DB_REACHING = /from\s+"(?:\.\/|@\/lib\/portfolio\/)(portfolio-budget|investment-read-model|tie-out|tie-out-panel-data|budget-reservation|epic-portfolio-attribution)"/;
  it.each(["tie-out-view.ts", "ai-resource.ts", "budget-label.ts"])("%s has no value import of a database module", (file) => {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    const valueImports = source.split(/\r?\n/).filter((line) => /^import\s+(?!type\b)/.test(line));
    expect(valueImports.filter((line) => DB_REACHING.test(line))).toEqual([]);
  });
});
