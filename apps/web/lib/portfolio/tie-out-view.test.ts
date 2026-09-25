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
