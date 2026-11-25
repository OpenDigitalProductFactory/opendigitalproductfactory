import { describe, expect, it } from "vitest";

import {
  computeClosureScorecard,
  describeClosureScorecard,
  direction,
  percent,
  streamState,
  weekFlows,
  type ClosureCounts,
  type ClosureSnapshot,
} from "./measures";

// BI-97C56E20: shaped on the 2026-11-25 production read.
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

describe("streamState and percent", () => {
  it("names accumulating, closing, idle and no-baseline streams", () => {
    expect(streamState(40, 0)).toBe("accumulating");
    expect(streamState(10, 10)).toBe("closing");
    expect(streamState(0, 0)).toBe("idle");
    expect(streamState(null, 3)).toBe("no-baseline");
  });

  it("is null on an empty denominator", () => {
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33);
  });
});

describe("weekFlows", () => {
  it("is all null without a baseline snapshot", () => {
    expect(Object.values(weekFlows(snapshot(), null)).every((v) => v === null)).toBe(true);
  });

  it("derives flows from state-count differences, never from timestamps", () => {
    const before = snapshot();
    const now = snapshot({
      builds: { total: 554, complete: 4, abandoned: 371, failed: 72, stranded: 60 },
      signals: { total: 490, open: 395, closed: 95 },
      proposals: { total: 1395, open: 1333, implemented: 40, rejected: 22 },
    });
    const flows = weekFlows(now, before);
    expect(flows).toMatchObject({
      buildsStarted: 20, buildsCompleted: 3, buildsEnded: 10,
      signalsFiled: 34, signalsClosed: 95,
      proposalsFiled: 9, proposalsImplemented: 39, proposalsEnded: 61,
    });
  });

  it("counts a rejected proposal as ended but never as implemented", () => {
    const flows = weekFlows(snapshot({ proposals: { total: 1386, open: 1375, implemented: 1, rejected: 10 } }), snapshot());
    expect(flows.proposalsImplemented).toBe(0);
    expect(flows.proposalsEnded).toBe(10);
  });

  it("an unrelated edit that changes no state moves no flow", () => {
    const flows = weekFlows(snapshot(), snapshot());
    expect(flows.signalsClosed).toBe(0);
    expect(flows.proposalsImplemented).toBe(0);
    expect(flows.buildsCompleted).toBe(0);
  });
});

describe("computeClosureScorecard", () => {
  it("records a baseline with no stream state on the first run", () => {
    const card = computeClosureScorecard(counts(), null);
    expect(card.streams.every((s) => s.state === "no-baseline")).toBe(true);
    expect(describeClosureScorecard(card)).toMatch(/^Baseline recorded/);
  });

  it("keeps peer-owned acceptance apart from items this install can close", () => {
    const byKey = Object.fromEntries(computeClosureScorecard(counts(), null).lines.map((l) => [l.key, l.value]));
    expect(byKey["acceptance.local"]).toBe(46);
    expect(byKey["acceptance.peerOwned"]).toBe(348);
    expect(byKey["asks.ownerShare"]).toBe(10);
  });

  it("names accumulating streams and compares flow lines with the prior run's flows", () => {
    const prior = { counts: counts(), flows: weekFlows(snapshot(), snapshot()) };
    const now = counts(snapshot({ signals: { total: 490, open: 395, closed: 95 }, builds: { total: 554, complete: 1, abandoned: 364, failed: 72, stranded: 80 } }));
    const card = computeClosureScorecard(now, prior);
    const dir = Object.fromEntries(card.lines.map((l) => [l.key, l.direction]));
    expect(dir["signals.closed"]).toBe("improving");
    expect(dir["builds.stranded"]).toBe("worsening");
    expect(card.accumulating).toContain("Build Studio builds");
    expect(card.streams.find((s) => s.key === "signals")?.state).toBe("closing");
    expect(describeClosureScorecard(card)).toMatch(/Worse than a week ago: .*untouched for over 7 days/);
  });
});
