import type { BacklogStatus } from "@/lib/backlog/transitions";

import { acceptanceEnteredAt, type AcceptanceAgeBasis } from "./acceptance-age";

// The awaiting-acceptance pool's age, measured every sweep run (BI-DF255666).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md
// §3.2 (age from state entry) and AC-AA-06 (the over-30-day trend is recorded
// by every run).
//
// Age is cheap, so it is measured for the whole pool: two reads, no readiness.
// Readiness stays bounded by the page. The age itself comes only from S1's
// acceptanceEnteredAt; `updatedAt` is never selected.

const AWAITING_ACCEPTANCE: BacklogStatus = "awaiting-acceptance";
const DAY_MS = 86_400_000;

export const ACCEPTANCE_AGE_BANDS = ["under-7d", "7-14d", "14-30d", "over-30d"] as const;
export type AcceptanceAgeBand = (typeof ACCEPTANCE_AGE_BANDS)[number];

export type AcceptancePoolAge = {
  rowId: string;
  itemId: string;
  enteredAt: Date;
  ageBasis: AcceptanceAgeBasis;
  ageDays: number;
};

/** Whole days in the state. */
export function acceptanceAgeDays(enteredAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - enteredAt.getTime()) / DAY_MS));
}

/** Bands at one review point (7), aged (14, design §3.2) and the trend line (30, AC-AA-06). */
export function acceptanceAgeBand(ageDays: number): AcceptanceAgeBand {
  if (ageDays < 7) return "under-7d";
  if (ageDays < 14) return "7-14d";
  if (ageDays <= 30) return "14-30d";
  return "over-30d";
}

export type AcceptancePoolAgeDb = {
  backlogItem: {
    findMany(args: {
      where: { status: BacklogStatus };
      select: { id: true; itemId: true; createdAt: true };
    }): Promise<Array<{ id: string; itemId: string; createdAt: Date }>>;
  };
  backlogItemActivity: {
    findMany(args: {
      where: {
        kind: "status_change";
        payload: { path: ["to"]; equals: BacklogStatus };
        backlogItem: { status: BacklogStatus };
      };
      select: { backlogItemId: true; recordedAt: true; payload: true };
    }): Promise<Array<{ backlogItemId: string; recordedAt: Date; payload: unknown }>>;
  };
};

/** Every awaiting-acceptance item's entry and age, keyed by row id. */
export async function loadAcceptancePoolAges(db: AcceptancePoolAgeDb, now: Date): Promise<Map<string, AcceptancePoolAge>> {
  const items = await db.backlogItem.findMany({
    where: { status: AWAITING_ACCEPTANCE },
    select: { id: true, itemId: true, createdAt: true },
  });
  // Every candidate entry row, not just the newest: acceptance-miss rows also
  // carry to = awaiting-acceptance and S1's function skips them.
  const rows = await db.backlogItemActivity.findMany({
    where: {
      kind: "status_change",
      payload: { path: ["to"], equals: AWAITING_ACCEPTANCE },
      backlogItem: { status: AWAITING_ACCEPTANCE },
    },
    select: { backlogItemId: true, recordedAt: true, payload: true },
  });
  const rowsByItem = new Map<string, Array<{ kind: string; recordedAt: Date; payload: unknown }>>();
  for (const row of rows) {
    const list = rowsByItem.get(row.backlogItemId) ?? [];
    list.push({ kind: "status_change", recordedAt: row.recordedAt, payload: row.payload });
    rowsByItem.set(row.backlogItemId, list);
  }
  const ages = new Map<string, AcceptancePoolAge>();
  for (const item of items) {
    const entry = acceptanceEnteredAt(rowsByItem.get(item.id) ?? [], item.createdAt);
    ages.set(item.id, {
      rowId: item.id,
      itemId: item.itemId,
      enteredAt: entry.enteredAt,
      ageBasis: entry.ageBasis,
      ageDays: acceptanceAgeDays(entry.enteredAt, now),
    });
  }
  return ages;
}

export type AcceptancePoolAgeSummary = {
  size: number;
  ageBands: Record<AcceptanceAgeBand, number>;
  /** At or past the aged threshold (ACCEPTANCE_AGED_DAYS). */
  aged: number;
  /** Past the trend line (ACCEPTANCE_TREND_DAYS): the AC-AA-06 count. */
  agedOverTrend: number;
  trendDays: number;
  /** Ages measured from createdAt: upper bounds, never entry age. */
  ageBasisCreated: number;
  oldestAgeDays: number | null;
};

export function summarizePoolAge(
  ages: Iterable<Pick<AcceptancePoolAge, "ageDays" | "ageBasis">>,
  thresholds: { agedDays: number; trendDays: number },
): AcceptancePoolAgeSummary {
  const ageBands = Object.fromEntries(ACCEPTANCE_AGE_BANDS.map((band) => [band, 0])) as Record<AcceptanceAgeBand, number>;
  let size = 0;
  let aged = 0;
  let agedOverTrend = 0;
  let ageBasisCreated = 0;
  let oldestAgeDays: number | null = null;
  for (const age of ages) {
    size += 1;
    ageBands[acceptanceAgeBand(age.ageDays)] += 1;
    if (age.ageDays >= thresholds.agedDays) aged += 1;
    if (age.ageDays > thresholds.trendDays) agedOverTrend += 1;
    if (age.ageBasis === "created") ageBasisCreated += 1;
    if (oldestAgeDays === null || age.ageDays > oldestAgeDays) oldestAgeDays = age.ageDays;
  }
  return { size, ageBands, aged, agedOverTrend, trendDays: thresholds.trendDays, ageBasisCreated, oldestAgeDays };
}
