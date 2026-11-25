import { describe, expect, it } from "vitest";

import {
  computeClosureScorecard,
  describeClosureScorecard,
  direction,
  percent,
  streamState,
  type ClosureCounts,
} from "./measures";

// BI-97C56E20: the 2026-11-25 baseline the owner asked about, as a fixture.
function baseline(overrides: Partial<ClosureCounts> = {}): ClosureCounts {
  return {
    builds: { started: 31, completed: 0, abandoned: 9, failed: 1, stranded: 62 },
    signals: { filed: 40, closed: 0, open: 456 },
    proposals: { filed: 60, closedOrVerified: 0, open: 1385 },
    escalations: { routedToAgent: 40, reachedOwner: 20, held: 78, oldestHeldDays: 49 },
    decisions: { total: 1400, recommended: 1300 },
    acceptance: { local: 46, peerOwned: 348, localMedianAgeDays: 20 },
    backlog: { filed: 300, done: 120, retired: 90 },
    selfFiled: { filed: 150, done: 10 },
    ...overrides,
  };
}

describe("direction", () => {
  it("has no baseline without a prior value", () => {
    expect(direction(5, null, "higher")).toBe("no-baseline");
    expect(direction(null, 5, "higher")).toBe("no-baseline");
  });

  it("reads a rise as improving only where higher is better", () => {
    expect(direction(10, 5, "higher")).toBe("improving");
    expect(direction(10, 5, "lower")).toBe("worsening");
    expect(direction(2, 5, "lower")).toBe("improving");
  });

  it("treats a change within 5% as flat, and a move off zero as a change", () => {
    expect(direction(102, 100, "higher")).toBe("flat");
    expect(direction(1, 0, "higher")).toBe("improving");
    expect(direction(0, 0, "lower")).toBe("flat");
  });
});

describe("streamState", () => {
  it("is accumulating when more arrived than left", () => {
    expect(streamState(40, 0)).toBe("accumulating");
    expect(streamState(10, 10)).toBe("closing");
    expect(streamState(0, 0)).toBe("idle");
  });
});

describe("percent", () => {
  it("is null on an empty denominator", () => {
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33);
  });
});

describe("computeClosureScorecard", () => {
  it("names every stream that is accumulating on the 2026-11-25 baseline", () => {
    const card = computeClosureScorecard(baseline(), null);
    expect(card.accumulating).toEqual([
      "Build Studio builds",
      "Improvement signals",
      "Improvement proposals",
      "Backlog items",
      "Self-filed items",
    ]);
    expect(card.lines.every((line) => line.direction === "no-baseline")).toBe(true);
  });

  it("keeps peer-owned acceptance apart from items this install can close", () => {
    const card = computeClosureScorecard(baseline(), null);
    const byKey = Object.fromEntries(card.lines.map((l) => [l.key, l.value]));
    expect(byKey["acceptance.local"]).toBe(46);
    expect(byKey["acceptance.peerOwned"]).toBe(348);
    expect(byKey["escalations.ownerShare"]).toBe(33);
  });

  it("shows a fix as a change of direction against the prior week", () => {
    const prior = baseline();
    const now = baseline({
      signals: { filed: 30, closed: 95, open: 391 },
      escalations: { routedToAgent: 50, reachedOwner: 5, held: 10, oldestHeldDays: 3 },
    });
    const card = computeClosureScorecard(now, prior);
    const dir = Object.fromEntries(card.lines.map((l) => [l.key, l.direction]));
    expect(dir["signals.closed"]).toBe("improving");
    expect(dir["signals.open"]).toBe("improving");
    expect(dir["escalations.held"]).toBe("improving");
    expect(dir["escalations.ownerShare"]).toBe("improving");
    expect(dir["builds.stranded"]).toBe("flat");
    expect(card.streams.find((s) => s.key === "signals")?.state).toBe("closing");
  });

  it("summarises in one line, naming what accumulated and what got worse", () => {
    const prior = baseline();
    const now = baseline({ builds: { started: 31, completed: 0, abandoned: 9, failed: 1, stranded: 80 } });
    const text = describeClosureScorecard(computeClosureScorecard(now, prior));
    expect(text).toMatch(/^Accumulating: Build Studio builds/);
    expect(text).toMatch(/Worse than a week ago: build studio builds untouched for over 7 days/);
  });
});
