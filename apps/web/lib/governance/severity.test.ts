import { describe, expect, it } from "vitest";

import {
  compareSeverity,
  fromLadderString,
  fromLintSeverity,
  GOVERNANCE_SEVERITIES,
  highestSeverity,
  maxSeverity,
  severityRank,
} from "./severity";

describe("governance severity ladder (EP-8DC217EB BET-12)", () => {
  it("ranks critical > high > medium > low > info", () => {
    const ranks = GOVERNANCE_SEVERITIES.map(severityRank);
    expect(ranks).toEqual([4, 3, 2, 1, 0]);
  });

  it("compareSeverity orders ascending by rank", () => {
    expect(compareSeverity("low", "high")).toBeLessThan(0);
    expect(compareSeverity("critical", "info")).toBeGreaterThan(0);
    expect(compareSeverity("medium", "medium")).toBe(0);
  });

  it("maxSeverity / highestSeverity pick the most severe", () => {
    expect(maxSeverity("low", "high")).toBe("high");
    expect(maxSeverity("critical", "high")).toBe("critical");
    expect(highestSeverity(["info", "medium", "low"])).toBe("medium");
    expect(highestSeverity([])).toBe("info");
  });

  it("folds lint severity onto the ladder (error→high, warn→medium, info→info)", () => {
    expect(fromLintSeverity("error")).toBe("high");
    expect(fromLintSeverity("warn")).toBe("medium");
    expect(fromLintSeverity("info")).toBe("info");
  });

  it("passes through a canonical ladder string and defaults unknowns to info", () => {
    expect(fromLadderString("critical")).toBe("critical");
    expect(fromLadderString("low")).toBe("low");
    expect(fromLadderString("bogus")).toBe("info");
    expect(fromLadderString("")).toBe("info");
  });
});
