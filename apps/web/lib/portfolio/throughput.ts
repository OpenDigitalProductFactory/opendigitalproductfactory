// Capacity as measured throughput (BI-CBF5D708, design §5.5). Points reaching
// done per week, per portfolio and per delivery surface, over a rolling
// six-week window. The forecast is a range (p15–p85 of the weekly samples), not
// a single figure, and it says "estimated" until the install has four weeks of
// delivery history. This is the capacity side in the same unit as the budget,
// which is what lets the two tie out.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { percentile } from "@/lib/queue/flow-metrics";

import { loadInvestmentItems, resolveInvestmentItem, type DeliverySurface, type InvestmentItemRow } from "./investment-read-model";

export const THROUGHPUT_WINDOW_WEEKS = 6;
export const MEASURED_MIN_WEEKS = 4;

const WEEK_MS = 7 * 86_400_000;

export type DeliveredPoints = {
  portfolioId: string | null;
  points: number;
  completedAt: Date;
  surface: DeliverySurface;
};

export type PortfolioThroughput = {
  portfolioId: string | null;
  /** Points delivered per week, oldest first; the last entry is the current week. */
  samples: number[];
  range: { low: number; median: number; high: number };
  label: "measured" | "estimated";
  bySurface: Record<DeliverySurface, number>;
};

export function measureThroughput(
  delivered: DeliveredPoints[],
  options: { now: Date; historyStart: Date | null },
): { weeksOfHistory: number; portfolios: PortfolioThroughput[] } {
  const windowStart = options.now.getTime() - THROUGHPUT_WINDOW_WEEKS * WEEK_MS;
  const weeksOfHistory = options.historyStart
    ? Math.min(THROUGHPUT_WINDOW_WEEKS, Math.floor((options.now.getTime() - options.historyStart.getTime()) / WEEK_MS))
    : 0;
  const label = weeksOfHistory >= MEASURED_MIN_WEEKS ? "measured" : "estimated";
  const byPortfolio = new Map<string | null, PortfolioThroughput>();
  for (const item of delivered) {
    const at = item.completedAt.getTime();
    if (at <= windowStart || at > options.now.getTime()) continue;
    const row = byPortfolio.get(item.portfolioId) ?? {
      portfolioId: item.portfolioId,
      samples: Array.from({ length: THROUGHPUT_WINDOW_WEEKS }, () => 0),
      range: { low: 0, median: 0, high: 0 },
      label,
      bySurface: { "build-studio": 0, external: 0, other: 0 },
    };
    const week = Math.min(THROUGHPUT_WINDOW_WEEKS - 1, Math.floor((at - windowStart) / WEEK_MS));
    row.samples[week]! += item.points;
    row.bySurface[item.surface] += item.points;
    byPortfolio.set(item.portfolioId, row);
  }
  for (const row of byPortfolio.values()) {
    // Only the weeks the install has history for count as samples.
    const samples = row.samples.slice(THROUGHPUT_WINDOW_WEEKS - Math.max(1, weeksOfHistory));
    row.range = {
      low: percentile(samples, 0.15) ?? 0,
      median: percentile(samples, 0.5) ?? 0,
      high: percentile(samples, 0.85) ?? 0,
    };
  }
  return { weeksOfHistory, portfolios: [...byPortfolio.values()] };
}

/** Points delivered in the throughput window, each item attributed to its portfolio. Pure. */
export function deliveredPointsFrom(windowItems: InvestmentItemRow[], now: Date): DeliveredPoints[] {
  const window = { start: new Date(now.getTime() - THROUGHPUT_WINDOW_WEEKS * WEEK_MS), end: new Date(now.getTime() + 1) };
  return windowItems.flatMap((item) => {
    const { resolution, itemClass, points } = resolveInvestmentItem(item, window);
    return itemClass === "delivered" && points !== null && item.completedAt
      ? [{ portfolioId: resolution.portfolioId, points, completedAt: new Date(item.completedAt), surface: item.deliverySurface }]
      : [];
  });
}

type ReadDb = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

/** Measured throughput from the install's own delivery history. */
export async function loadThroughput(db: ReadDb, now: Date = new Date()) {
  const window = { start: new Date(now.getTime() - THROUGHPUT_WINDOW_WEEKS * WEEK_MS), end: new Date(now.getTime() + 1) };
  const [windowItems, [history]] = await Promise.all([
    loadInvestmentItems(db, window),
    db.$queryRaw<Array<{ start: Date | null }>>`SELECT MIN("completedAt") AS "start" FROM "BacklogItem" WHERE "status" = 'done'`,
  ]);
  return { windowItems, historyStart: history?.start ? new Date(history.start) : null };
}

/** A portfolio's median weekly points, once measured; null while the forecast is still estimated. */
export function measuredWeeklyThroughput(throughput: ReturnType<typeof measureThroughput>, portfolioId: string | null): number | null {
  const row = throughput.portfolios.find((p) => p.portfolioId === portfolioId);
  return row && row.label === "measured" ? row.range.median : null;
}
