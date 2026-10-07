import type { OwedAcceptance } from "./owed-acceptance";
import { summarizePoolAge, type AcceptancePoolAge, type AcceptancePoolAgeSummary } from "./acceptance-pool-age";
import type { AcceptanceSweepPage, AcceptanceSweepPageItem } from "./acceptance-sweep-page";

// One acceptance sweep run (BI-DF255666, AC-S2-2 and AC-S2-3).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.3.
// Plan:   docs/superpowers/plans/2026-09-24-acceptance-accountability-plan.md, phase 2.
//
// Level-triggered reconcile with bounded work per pass: measure the pool's age
// (cheap, whole pool), evaluate readiness for one page, record the owed
// projection where it changed, and write one summary. Every I/O step is a port
// so the run is tested without a database; acceptance-sweep-task.ts binds them.
//
// Nothing here closes or routes an item. Closing stays the terminal
// transition's decision, made through its gate; routing is phase 3
// (BI-C1781121) and stays off until it lands.

export type AcceptanceSweepConfig = {
  pageSize: number;
  agedDays: number;
  trendDays: number;
  routing: false;
  recordedByAgentId: string;
};

export type AcceptanceSweepPorts = {
  now: Date;
  loadPoolAges(): Promise<Map<string, AcceptancePoolAge>>;
  /** The cursor the previous run recorded, or null on the first run. */
  loadLastCursor(): Promise<string | null>;
  selectPage(args: { pageSize: number; cursor: string | null }): Promise<AcceptanceSweepPage>;
  /** The item's owed projection, or null when its readiness cannot be computed. */
  evaluate(item: AcceptanceSweepPageItem): Promise<OwedAcceptance | null>;
  recordSnapshot(item: AcceptanceSweepPageItem, projection: OwedAcceptance): Promise<{ written: boolean }>;
  recordRun(summary: AcceptanceSweepSummary): Promise<{ activityId: string }>;
};

export type AcceptanceSweepSummary = {
  schemaVersion: 1;
  ranAt: string;
  headline: string;
  /** The whole awaiting-acceptance pool, by age from state entry. */
  pool: AcceptancePoolAgeSummary;
  /** The page this run evaluated. */
  page: {
    pageSize: number;
    evaluated: number;
    unsnapshotted: number;
    snapshotsWritten: number;
    readinessUnavailable: number;
    closable: number;
    owned: number;
    unroutableItems: number;
    unroutableByCode: Record<string, number>;
    unroutableByReason: Record<string, number>;
    ageBasisCreated: number;
    aged: number;
    agedOverTrend: number;
  };
  /** Page item ids, bounded by the page size. */
  items: {
    closable: string[];
    aged: string[];
    unroutable: string[];
    readinessUnavailable: string[];
  };
  /** Design §7: the revisit period, stated so a pool past the ceiling stays visible. */
  revisit: { poolSize: number; pageSize: number; runsPerRevisit: number; exceedsTrendWindow: boolean };
  routing: { enabled: false; routed: 0 };
  cursor: string | null;
};

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function headline(summary: Omit<AcceptanceSweepSummary, "headline">, agedDays: number): string {
  const { pool, page } = summary;
  return [
    `Acceptance sweep: ${pool.size} awaiting acceptance, ${pool.aged} aged ${agedDays}+ days`,
    `${pool.agedOverTrend} over ${pool.trendDays} days`,
    `${pool.ageBasisCreated} aged from creation (no entry record)`,
    `page of ${page.evaluated}: ${page.snapshotsWritten} changed, ${page.closable} closable, ${page.owned} with an owner, ${page.unroutableItems} unroutable`,
  ].join("; ").slice(0, 500);
}

export async function runAcceptanceSweep(
  ports: AcceptanceSweepPorts,
  config: AcceptanceSweepConfig,
): Promise<AcceptanceSweepSummary> {
  const ages = await ports.loadPoolAges();
  const pool = summarizePoolAge(ages.values(), { agedDays: config.agedDays, trendDays: config.trendDays });

  const cursor = await ports.loadLastCursor();
  const selected = await ports.selectPage({ pageSize: config.pageSize, cursor });
  const items = selected.items.slice(0, Math.max(0, config.pageSize));
  const nextCursor = items.length === selected.items.length
    ? selected.nextCursor
    : cursorWithin(items.slice(selected.unsnapshotted), cursor);

  const page: AcceptanceSweepSummary["page"] = {
    pageSize: config.pageSize,
    evaluated: items.length,
    unsnapshotted: Math.min(selected.unsnapshotted, items.length),
    snapshotsWritten: 0,
    readinessUnavailable: 0,
    closable: 0,
    owned: 0,
    unroutableItems: 0,
    unroutableByCode: {},
    unroutableByReason: {},
    ageBasisCreated: 0,
    aged: 0,
    agedOverTrend: 0,
  };
  const listed: AcceptanceSweepSummary["items"] = { closable: [], aged: [], unroutable: [], readinessUnavailable: [] };

  for (const item of items) {
    const itemAge = ages.get(item.id);
    if (itemAge) {
      if (itemAge.ageBasis === "created") page.ageBasisCreated += 1;
      if (itemAge.ageDays >= config.agedDays) {
        page.aged += 1;
        listed.aged.push(item.itemId);
      }
      if (itemAge.ageDays > config.trendDays) page.agedOverTrend += 1;
    }

    const projection = await ports.evaluate(item).catch(() => null);
    if (!projection) {
      page.readinessUnavailable += 1;
      listed.readinessUnavailable.push(item.itemId);
      continue;
    }
    const snapshot = await ports.recordSnapshot(item, projection);
    if (snapshot.written) page.snapshotsWritten += 1;
    if (projection.closable) {
      page.closable += 1;
      listed.closable.push(item.itemId);
    }
    if (projection.owner) page.owned += 1;
    if (projection.unroutable.length > 0) {
      page.unroutableItems += 1;
      listed.unroutable.push(item.itemId);
      for (const entry of projection.unroutable) {
        increment(page.unroutableByCode, entry.code);
        increment(page.unroutableByReason, entry.reason);
      }
    }
  }

  const runsPerRevisit = config.pageSize > 0 ? Math.ceil(pool.size / config.pageSize) : 0;
  const withoutHeadline: Omit<AcceptanceSweepSummary, "headline"> = {
    schemaVersion: 1,
    ranAt: ports.now.toISOString(),
    pool,
    page,
    items: listed,
    // The sweep runs daily, so runs per revisit is also the revisit period in days.
    revisit: {
      poolSize: pool.size,
      pageSize: config.pageSize,
      runsPerRevisit,
      exceedsTrendWindow: runsPerRevisit > config.trendDays,
    },
    routing: { enabled: false, routed: 0 },
    cursor: nextCursor,
  };
  const summary: AcceptanceSweepSummary = { ...withoutHeadline, headline: headline(withoutHeadline, config.agedDays) };
  await ports.recordRun(summary);
  return summary;
}

/** When the page was truncated, the cursor is the last snapshotted item actually evaluated. */
function cursorWithin(revisited: AcceptanceSweepPageItem[], previous: string | null): string | null {
  return revisited.length > 0 ? revisited[revisited.length - 1]!.id : previous;
}
