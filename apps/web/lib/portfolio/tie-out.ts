// The portfolio tie-out (BI-CBF5D708, design §6): one row per portfolio for the
// quarter, plus the unallocated row. Budget against measured capacity, in one
// unit. Every row states its traced share, so a total that silently omits work
// done outside the system never looks complete. The tie-out reports and steers;
// it never dispatches.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { quarterBounds } from "./investment-points";
import { loadInvestmentItems, resolveInvestmentItem, type InvestmentItemRow } from "./investment-read-model";
import { loadPortfolioBudgets, type PortfolioBudget } from "./portfolio-budget";
import { deliveredPointsFrom, loadThroughput, measureThroughput, THROUGHPUT_WINDOW_WEEKS, type PortfolioThroughput } from "./throughput";

const WEEK_MS = 7 * 86_400_000;

export type TieOutRow = {
  /** null is the unallocated row. */
  portfolioId: string | null;
  name: string;
  /** null = no budget set, never zero. */
  budget: PortfolioBudget | null;
  reservedPoints: number;
  inFlightPoints: number;
  deliveredPoints: number;
  /** Points reserved or in flight, each item counted once: what remains to deliver. */
  committedPoints: number;
  /** Capacity to the end of the quarter: weekly throughput range x weeks remaining. */
  forecast: { low: number; median: number; high: number; label: "measured" | "estimated" };
  /**
   * Committed minus forecast capacity. Positive is over-committed. The points
   * figure is a range (against the high and the low forecast); weeks compares
   * the time the commitment takes at median throughput with the weeks left.
   */
  overCommitment: { pointsLow: number; pointsHigh: number; weeks: number | null };
  /** Share of this quarter's delivered points that carry Workroom or PR evidence; null when nothing was delivered. */
  tracedShare: number | null;
  bySurface: PortfolioThroughput["bySurface"];
};

export type PortfolioTieOut = {
  period: { start: Date; end: Date };
  weeksRemaining: number;
  weeksOfHistory: number;
  rows: TieOutRow[];
  /** Merged pull requests whose Workroom names no backlog item: work the rows cannot see. */
  untracedChanges: number;
};

/** Pure: assemble the tie-out from loaded facts. */
export function assembleTieOut(input: {
  now: Date;
  portfolios: Array<{ id: string; name: string }>;
  quarterItems: InvestmentItemRow[];
  windowItems: InvestmentItemRow[];
  historyStart: Date | null;
  budgets: Map<string, PortfolioBudget | null>;
  openReservations: Array<{ itemId: string; portfolioId: string; points: number }>;
  untracedChanges: number;
}): PortfolioTieOut {
  const period = quarterBounds(input.now);
  const weeksRemaining = Math.max(0, (period.end.getTime() - input.now.getTime()) / WEEK_MS);

  const throughput = measureThroughput(deliveredPointsFrom(input.windowItems, input.now), { now: input.now, historyStart: input.historyStart });

  const reservedByItem = new Map(input.openReservations.map((r) => [r.itemId, r]));
  const acc = new Map<string | null, { reserved: number; inFlight: number; delivered: number; committed: number; tracedDelivered: number }>();
  const bucket = (id: string | null) => {
    const row = acc.get(id) ?? { reserved: 0, inFlight: 0, delivered: 0, committed: 0, tracedDelivered: 0 };
    acc.set(id, row);
    return row;
  };
  for (const r of input.openReservations) bucket(r.portfolioId).reserved += r.points;
  for (const item of input.quarterItems) {
    const { resolution, itemClass, points } = resolveInvestmentItem(item, period);
    if (itemClass === null || points === null) continue;
    const row = bucket(resolution.portfolioId);
    if (itemClass === "inFlight") row.inFlight += points;
    if (itemClass === "delivered") {
      row.delivered += points;
      if (item.traced) row.tracedDelivered += points;
    }
    if (itemClass !== "delivered" && (itemClass === "inFlight" || reservedByItem.has(item.itemId))) row.committed += points;
  }

  const rowFor = (portfolioId: string | null, name: string): TieOutRow => {
    const a = acc.get(portfolioId) ?? { reserved: 0, inFlight: 0, delivered: 0, committed: 0, tracedDelivered: 0 };
    const t = throughput.portfolios.find((p) => p.portfolioId === portfolioId);
    const forecast = {
      low: Math.round((t?.range.low ?? 0) * weeksRemaining),
      median: Math.round((t?.range.median ?? 0) * weeksRemaining),
      high: Math.round((t?.range.high ?? 0) * weeksRemaining),
      label: t?.label ?? (throughput.weeksOfHistory >= 4 ? "measured" as const : "estimated" as const),
    };
    const median = t?.range.median ?? 0;
    return {
      portfolioId,
      name,
      budget: portfolioId ? input.budgets.get(portfolioId) ?? null : null,
      reservedPoints: a.reserved,
      inFlightPoints: a.inFlight,
      deliveredPoints: a.delivered,
      committedPoints: a.committed,
      forecast,
      overCommitment: {
        pointsLow: a.committed - forecast.high,
        pointsHigh: a.committed - forecast.low,
        weeks: median > 0 ? Math.round((a.committed / median - weeksRemaining) * 10) / 10 : null,
      },
      tracedShare: a.delivered > 0 ? Math.round((a.tracedDelivered / a.delivered) * 1000) / 1000 : null,
      bySurface: t?.bySurface ?? { "build-studio": 0, external: 0, other: 0 },
    };
  };

  return {
    period,
    weeksRemaining: Math.round(weeksRemaining * 10) / 10,
    weeksOfHistory: throughput.weeksOfHistory,
    rows: [...input.portfolios.map((p) => rowFor(p.id, p.name)), rowFor(null, "Unallocated")],
    untracedChanges: input.untracedChanges,
  };
}

type ReadDb = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

export async function loadPortfolioTieOut(db: ReadDb, now: Date = new Date()): Promise<PortfolioTieOut> {
  const period = quarterBounds(now);
  const window = { start: new Date(now.getTime() - THROUGHPUT_WINDOW_WEEKS * WEEK_MS), end: new Date(now.getTime() + 1) };
  const [quarterItems, { windowItems, historyStart }, budgets, openReservations, [untraced]] = await Promise.all([
    loadInvestmentItems(db, period),
    loadThroughput(db, now),
    loadPortfolioBudgets(db, period),
    db.$queryRaw<Array<{ itemId: string; portfolioId: string; points: number }>>`
      SELECT b."itemId", r."portfolioId", r."points" FROM "BudgetReservation" r JOIN "BacklogItem" b ON b."id" = r."backlogItemId"
       WHERE r."state" = 'reserved' AND r."periodStart" = ${period.start}`,
    db.$queryRaw<Array<{ n: number | string }>>`
      SELECT COUNT(*) AS "n" FROM "WorkCapsule" w
       WHERE w."pullRequestNumber" IS NOT NULL AND w."backlogItemId" IS NULL AND w."updatedAt" >= ${window.start}`,
  ]);
  return assembleTieOut({
    now,
    portfolios: budgets.map((b) => ({ id: b.id, name: b.name })),
    quarterItems,
    windowItems,
    historyStart,
    budgets: new Map(budgets.map((b) => [b.id, b.budget])),
    openReservations: openReservations.map((r) => ({ ...r, points: Number(r.points) })),
    untracedChanges: Number(untraced?.n ?? 0),
  });
}
