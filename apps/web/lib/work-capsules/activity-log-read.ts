// Read a Workroom's log from a position (BI-62514632, design
// docs/superpowers/specs/2026-10-07-durable-delegation-ledger-design.md §4.4).
//
// Every activity row written since the sequence migration carries its room's
// next sequence number, assigned under the room's row lock. A reader that has
// seen up to N asks for rows after N and gets every later row exactly once, in
// order. Live wake-ups stay hints; this read is the source of truth.

export const ACTIVITY_PAGE_LIMIT = 200;

type ActivityLogDb = {
  workroomActivity: { findMany(args: unknown): Promise<unknown[]> };
};

/** Parse `afterSequence`: a non-negative integer, or undefined when absent. Null on a bad value. */
export function parseAfterSequence(raw: unknown): number | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function readActivityAfter(db: ActivityLogDb, input: {
  workCapsuleId: string;
  afterSequence: number;
  limit?: number;
}): Promise<{ activity: unknown[]; hasMore: boolean }> {
  const limit = Math.min(ACTIVITY_PAGE_LIMIT, Math.max(1, input.limit ?? ACTIVITY_PAGE_LIMIT));
  const rows = await db.workroomActivity.findMany({
    where: { workCapsuleId: input.workCapsuleId, sequence: { gt: input.afterSequence } },
    orderBy: { sequence: "asc" },
    take: limit + 1,
  });
  return { activity: rows.slice(0, limit), hasMore: rows.length > limit };
}
