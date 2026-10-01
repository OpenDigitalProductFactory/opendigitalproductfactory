import { describe, expect, it } from "vitest";

import { measureThroughput, THROUGHPUT_WINDOW_WEEKS } from "./throughput";

const now = new Date("2026-09-25T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("measureThroughput (BI-CBF5D708, design §5.5)", () => {
  it("sums delivered points per portfolio into one sample per week over a six-week window", () => {
    const result = measureThroughput([
      { portfolioId: "p1", points: 3, completedAt: daysAgo(1), surface: "build-studio" },
      { portfolioId: "p1", points: 8, completedAt: daysAgo(2), surface: "external" },
      { portfolioId: "p1", points: 1, completedAt: daysAgo(10), surface: "external" },
      { portfolioId: "p1", points: 5, completedAt: daysAgo(60), surface: "external" }, // outside the window
    ], { now, historyStart: daysAgo(200) });
    const p1 = result.portfolios.find((p) => p.portfolioId === "p1")!;
    expect(p1.samples).toHaveLength(THROUGHPUT_WINDOW_WEEKS);
    expect(p1.samples[THROUGHPUT_WINDOW_WEEKS - 1]).toBe(11);
    expect(p1.samples[THROUGHPUT_WINDOW_WEEKS - 2]).toBe(1);
    expect(p1.bySurface).toEqual({ "build-studio": 3, external: 9, other: 0 });
  });

  it("reports a p15-p85 range, not a single figure, and labels it measured with four or more weeks of history", () => {
    const items = [5, 5, 10, 10, 20, 40].map((points, week) => ({ portfolioId: "p1", points, completedAt: daysAgo(week * 7 + 1), surface: "other" as const }));
    const p1 = measureThroughput(items, { now, historyStart: daysAgo(200) }).portfolios[0]!;
    expect(p1.label).toBe("measured");
    expect(p1.range.low).toBeLessThan(p1.range.high);
    expect(p1.range.low).toBeGreaterThanOrEqual(5);
    expect(p1.range.high).toBeLessThanOrEqual(40);
  });

  it("labels the figure estimated when the install has fewer than four weeks of delivery history", () => {
    const result = measureThroughput([{ portfolioId: "p1", points: 3, completedAt: daysAgo(3), surface: "other" }], { now, historyStart: daysAgo(20) });
    expect(result.weeksOfHistory).toBe(2);
    expect(result.portfolios[0]!.label).toBe("estimated");
  });

  it("keeps unallocated delivery as its own row", () => {
    const result = measureThroughput([{ portfolioId: null, points: 3, completedAt: daysAgo(1), surface: "other" }], { now, historyStart: daysAgo(200) });
    expect(result.portfolios.map((p) => p.portfolioId)).toEqual([null]);
  });
});
