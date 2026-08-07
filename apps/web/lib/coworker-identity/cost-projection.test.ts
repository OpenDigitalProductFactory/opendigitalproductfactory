// apps/web/lib/coworker-identity/cost-projection.test.ts
// Unit tests for the pure cost summarizer (EP-COWORKER-IDENTITY-360 Phase 1).
import { describe, it, expect } from "vitest";

import {
  summarizeCoworkerCost,
  humanizeCostDriver,
  type CostUsageRow,
} from "./cost-projection";

const NOW = new Date("2026-08-07T12:00:00.000Z");

function daysAgo(n: number, hour = 6): Date {
  const d = new Date(NOW.getTime() - n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function usage(partial: Partial<CostUsageRow> & { createdAt: Date }): CostUsageRow {
  return {
    costUsd: 1,
    inputTokens: 100,
    outputTokens: 100,
    contextKey: "build.decompose",
    ...partial,
  };
}

describe("humanizeCostDriver", () => {
  it("cleans separators and title-cases", () => {
    expect(humanizeCostDriver("build.decompose")).toBe("Build Decompose");
    expect(humanizeCostDriver("route:/build/plan")).toBe("Build Plan");
  });
  it("falls back for empty keys", () => {
    expect(humanizeCostDriver("")).toBe("Uncategorized");
  });
});

describe("summarizeCoworkerCost", () => {
  it("sums only the current window and computes the delta vs the prior window", () => {
    const rows: CostUsageRow[] = [
      usage({ costUsd: 10, createdAt: daysAgo(2) }), // current
      usage({ costUsd: 5, createdAt: daysAgo(20) }), // current
      usage({ costUsd: 30, createdAt: daysAgo(40) }), // prior window (30-60d)
      usage({ costUsd: 99, createdAt: daysAgo(80) }), // outside both windows
    ];
    const s = summarizeCoworkerCost({
      usage: rows,
      budgetEvents: [],
      dailyTokenLimit: null,
      now: NOW,
      windowDays: 30,
    });
    expect(s.totalUsd).toBe(15);
    expect(s.priorTotalUsd).toBe(30);
    // (15 - 30) / 30 * 100 = -50
    expect(s.deltaPct).toBe(-50);
  });

  it("returns a null delta when there is no prior spend", () => {
    const s = summarizeCoworkerCost({
      usage: [usage({ costUsd: 4, createdAt: daysAgo(1) })],
      budgetEvents: [],
      dailyTokenLimit: null,
      now: NOW,
      windowDays: 30,
    });
    expect(s.deltaPct).toBeNull();
    expect(s.totalUsd).toBe(4);
  });

  it("ranks drivers by cost, descending, capped", () => {
    const rows: CostUsageRow[] = [
      usage({ costUsd: 3, contextKey: "build.decompose", createdAt: daysAgo(1) }),
      usage({ costUsd: 5, contextKey: "review.replan", createdAt: daysAgo(1) }),
      usage({ costUsd: 2, contextKey: "build.decompose", createdAt: daysAgo(2) }),
    ];
    const s = summarizeCoworkerCost({
      usage: rows,
      budgetEvents: [],
      dailyTokenLimit: null,
      now: NOW,
      windowDays: 30,
      maxDrivers: 2,
    });
    expect(s.drivers).toHaveLength(2);
    expect(s.drivers[0]).toMatchObject({ label: "Build Decompose", costUsd: 5 });
    expect(s.drivers[1]).toMatchObject({ label: "Review Replan", costUsd: 5 });
  });

  it("computes budget posture: tokens today vs the daily limit", () => {
    const rows: CostUsageRow[] = [
      // today (UTC) — 2 rows of 500+500 tokens = 2000 tokens
      usage({ inputTokens: 500, outputTokens: 500, createdAt: daysAgo(0, 1) }),
      usage({ inputTokens: 500, outputTokens: 500, createdAt: daysAgo(0, 8) }),
      // yesterday — should not count toward tokensToday
      usage({ inputTokens: 900, outputTokens: 900, createdAt: daysAgo(1) }),
    ];
    const s = summarizeCoworkerCost({
      usage: rows,
      budgetEvents: [],
      dailyTokenLimit: 10_000,
      now: NOW,
      windowDays: 30,
    });
    expect(s.budget.tokensToday).toBe(2000);
    expect(s.budget.usedPct).toBe(20);
  });

  it("counts only rejections within the last 24h", () => {
    const s = summarizeCoworkerCost({
      usage: [],
      budgetEvents: [
        { eventKind: "rejected", createdAt: new Date(NOW.getTime() - 3_600_000) }, // 1h ago
        { eventKind: "rejected", createdAt: new Date(NOW.getTime() - 48 * 3_600_000) }, // 2d ago
        { eventKind: "warning_95", createdAt: new Date(NOW.getTime() - 3_600_000) },
      ],
      dailyTokenLimit: null,
      now: NOW,
      windowDays: 30,
    });
    expect(s.budget.recentRejections).toBe(1);
  });

  it("builds an ascending daily spend series for the current window only", () => {
    const rows: CostUsageRow[] = [
      usage({ costUsd: 2, createdAt: daysAgo(1) }),
      usage({ costUsd: 3, createdAt: daysAgo(3) }),
      usage({ costUsd: 1, createdAt: daysAgo(40) }), // prior window — excluded
    ];
    const s = summarizeCoworkerCost({
      usage: rows,
      budgetEvents: [],
      dailyTokenLimit: null,
      now: NOW,
      windowDays: 30,
    });
    expect(s.dailyUsd).toHaveLength(2);
    expect(s.dailyUsd[0].day < s.dailyUsd[1].day).toBe(true);
    expect(s.dailyUsd.reduce((a, b) => a + b.usd, 0)).toBe(5);
  });
});
