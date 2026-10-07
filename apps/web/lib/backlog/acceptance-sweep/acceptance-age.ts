import type { BacklogStatus } from "@/lib/backlog/transitions";

// Time in awaiting-acceptance, measured from state entry (BI-04140C98, AC-AA-02).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.2.
//
// `updatedAt` is not an age: any edit or backfill moves it, and reading it as
// one is exactly how the 2026-09-21 backfill was once misread as months of
// rot. This module never selects or reads it.

const AWAITING_ACCEPTANCE: BacklogStatus = "awaiting-acceptance";

export type AcceptanceAgeBasis = "entry" | "created";

export type AcceptanceEntry = {
  enteredAt: Date;
  /**
   * `entry`: a recorded transition into awaiting-acceptance.
   * `created`: no entry row exists (the item entered before the actuators
   * wrote one), so the age is an upper bound from createdAt and must never be
   * presented as entry age.
   */
  ageBasis: AcceptanceAgeBasis;
};

export type AcceptanceStateActivity = {
  kind: string;
  recordedAt: Date;
  payload: unknown;
};

function isEntryIntoAcceptance(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const { from, to } = payload as { from?: unknown; to?: unknown };
  // An acceptance-miss row (fileAcceptanceMiss) records from === to: the item
  // stayed where it was, so it is not an entry.
  return to === AWAITING_ACCEPTANCE && from !== AWAITING_ACCEPTANCE;
}

/** The latest state entry, or createdAt marked as such. */
export function acceptanceEnteredAt(
  activities: readonly AcceptanceStateActivity[],
  createdAt: Date,
): AcceptanceEntry {
  let latest: Date | null = null;
  for (const activity of activities) {
    if (activity.kind !== "status_change" || !isEntryIntoAcceptance(activity.payload)) continue;
    if (!latest || activity.recordedAt.getTime() > latest.getTime()) latest = activity.recordedAt;
  }
  return latest ? { enteredAt: latest, ageBasis: "entry" } : { enteredAt: createdAt, ageBasis: "created" };
}

export type AcceptanceEntryDb = {
  backlogItem: {
    findUnique(args: { where: { id: string }; select: { createdAt: true } }): Promise<{ createdAt: Date } | null>;
  };
  backlogItemActivity: {
    findMany(args: {
      where: {
        backlogItemId: string;
        kind: "status_change";
        payload: { path: ["to"]; equals: BacklogStatus };
      };
      orderBy: Array<{ recordedAt: "desc" } | { id: "desc" }>;
      select: { recordedAt: true; payload: true };
    }): Promise<Array<{ recordedAt: Date; payload: unknown }>>;
  };
};

/** Load the entry for one item by row id. Null when the item does not exist. */
export async function loadAcceptanceEntry(db: AcceptanceEntryDb, backlogItemId: string): Promise<AcceptanceEntry | null> {
  const item = await db.backlogItem.findUnique({ where: { id: backlogItemId }, select: { createdAt: true } });
  if (!item) return null;
  // Uses the [backlogItemId, recordedAt desc] index. Every candidate row is
  // read, not just the newest: acceptance-miss rows also carry
  // to = awaiting-acceptance and must be skipped, not counted.
  const rows = await db.backlogItemActivity.findMany({
    where: {
      backlogItemId,
      kind: "status_change",
      payload: { path: ["to"], equals: AWAITING_ACCEPTANCE },
    },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { recordedAt: true, payload: true },
  });
  return acceptanceEnteredAt(rows.map((row) => ({ kind: "status_change", ...row })), item.createdAt);
}
