import { describe, expect, it } from "vitest";

import {
  computeClosureScorecard,
  describeClosureScorecard,
  direction,
  percent,
  stockChanges,
  streamState,
  type ClosureCounts,
  type ClosureSnapshot,
} from "./measures";

// BI-97C56E20: shaped on the 2026-11-25 production baseline.
function snapshot(overrides: Partial<ClosureSnapshot> = {}): ClosureSnapshot {
  return {
    builds: { total: 534, complete: 1, abandoned: 364, failed: 72, stranded: 62 },
    signals: { total: 456, open: 456, closed: 0 },
    proposals: { total: 1386, open: 1385, implemented: 1, rejected: 0 },
    backlog: { total: 11869, done: 2164, retired: 4782 },
    selfFiled: { total: 3000, done: 400 },
    acceptance: { local: 46, peerOwned: 348, localMedianDaysSinceChange: 22 },
    escalations: { held: 78, oldestHeldDays: 49.6 },
    ...overrides,
  };
}

function counts(snap: ClosureSnapshot = snapshot(), asks = { forOwner: 6, routedToAgent: 52 }): ClosureCounts {
  return { snapshot: snap, window: { asks, decisions: { total: 1438, recommended: 1318 } } };
}

describe("direction and percent", () => {
  it("has no baseline without a prior value", () => {
    expect(direction(5, null, "higher")).toBe("no-baseline");
  });

  it("reads a rise as improving only where higher is better, with a 5% flat band", () => {
    expect(direction(10, 5, "higher")).toBe("improving");
    expect(direction(10, 5, "lower")).toBe("worsening");
    expect(direction(102, 100, "higher")).toBe("flat");
    expect(direction(1, 0, "higher")).toBe("improving");
  });

  it("is null on an empty denominator", () => {
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33);
  });
});

describe("streamState", () => {
  it("reads open-stock growth, shrinkage and steadiness", () => {
    expect(streamState(5, 5)).toBe("accumulating");
    expect(streamState(-3, 2)).toBe("reducing");
    expect(streamState(0, 0)).toBe("steady");
    expect(streamState(null, 3)).toBe("no-baseline");
  });

  it("never lets a shrinking total drive the verdict: that is deletion, not closure", () => {
    expect(streamState(-2, -2)).toBe("indeterminate");
    expect(streamState(-50, -1)).toBe("indeterminate");
  });
});

describe("stockChanges", () => {
  it("is all null without a baseline snapshot", () => {
    expect(Object.values(stockChanges(snapshot(), null)).every((v) => v === null)).toBe(true);
  });

  it("reports net change in stock per state", () => {
    const now = snapshot({
      builds: { total: 554, complete: 4, abandoned: 371, failed: 72, stranded: 60 },
      signals: { total: 490, open: 395, closed: 95 },
    });
    expect(stockChanges(now, snapshot())).toMatchObject({
      buildsTotal: 20, buildsComplete: 3, buildsOpen: 10,
      signalsTotal: 34, signalsClosed: 95, signalsOpen: -61,
    });
  });

  it("an edit that changes no state moves no stock", () => {
    const d = stockChanges(snapshot(), snapshot());
    expect([d.signalsClosed, d.proposalsImplemented, d.buildsComplete, d.buildsOpen]).toEqual([0, 0, 0, 0]);
  });

  it("counts a rejected proposal out of the open stock but never as implemented", () => {
    const d = stockChanges(snapshot({ proposals: { total: 1386, open: 1375, implemented: 1, rejected: 10 } }), snapshot());
    expect(d.proposalsImplemented).toBe(0);
    expect(d.proposalsOpen).toBe(-10);
  });
});

describe("computeClosureScorecard", () => {
  it("records a baseline with no verdict on the first run", () => {
    const card = computeClosureScorecard(counts(), null);
    expect(card.streams.every((s) => s.state === "no-baseline")).toBe(true);
    expect(describeClosureScorecard(card)).toMatch(/^Baseline recorded/);
  });

  it("deleting old builds is indeterminate, never 'reducing' and never shown as started/ended", () => {
    const before = snapshot();
    // Two abandoned builds deleted from the table: totals fall, nothing finished.
    const now = snapshot({ builds: { total: 532, complete: 1, abandoned: 362, failed: 72, stranded: 62 } });
    const card = computeClosureScorecard(counts(now), { counts: counts(before), changes: null });
    const builds = card.streams.find((s) => s.key === "builds")!;
    expect(builds.netTotalChange).toBe(-2);
    expect(builds.state).toBe("indeterminate");
    expect(card.accumulating).not.toContain("Build Studio builds");
    expect(card.lines.map((l) => l.label).join(" ")).not.toMatch(/\bstarted\b|\bended\b/i);
    expect(describeClosureScorecard(card)).toMatch(/build studio builds \d+ open \(\+?0, indeterminate\)/);
  });

  it("keeps peer-owned acceptance apart and labels every stock difference as net change", () => {
    const card = computeClosureScorecard(counts(), null);
    const byKey = Object.fromEntries(card.lines.map((l) => [l.key, l]));
    expect(byKey["acceptance.local"].value).toBe(46);
    expect(byKey["acceptance.peerOwned"].value).toBe(348);
    expect(byKey["asks.ownerShare"].value).toBe(10);
    for (const key of ["builds.completeNetChange", "signals.closedNetChange", "proposals.implementedNetChange", "selfFiled.doneNetChange"]) {
      expect(byKey[key].label).toMatch(/net change in stock/);
    }
  });

  it("names growing open stock and compares net-change lines with the prior run's changes", () => {
    const prior = { counts: counts(), changes: stockChanges(snapshot(), snapshot()) };
    const now = counts(snapshot({
      signals: { total: 490, open: 395, closed: 95 },
      builds: { total: 554, complete: 1, abandoned: 364, failed: 72, stranded: 80 },
    }));
    const card = computeClosureScorecard(now, prior);
    const dir = Object.fromEntries(card.lines.map((l) => [l.key, l.direction]));
    expect(dir["signals.closedNetChange"]).toBe("improving");
    expect(dir["builds.stranded"]).toBe("worsening");
    expect(card.streams.find((s) => s.key === "signals")?.state).toBe("reducing");
    expect(card.accumulating).toEqual(["Build Studio builds"]);
  });
});
