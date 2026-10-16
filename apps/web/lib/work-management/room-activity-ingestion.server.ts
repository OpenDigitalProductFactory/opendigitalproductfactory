import { Prisma } from "@dpf/db";

type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
export interface ActivityWindow { roomId: string; highWater: string }
export interface IngestedActivity {
  id: string; roomId: string; ingestionSequence: string;
  kind: string; summary: string; payload: Prisma.JsonValue; recordedAt: Date;
}

function position(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value)
    || BigInt(value) > 9223372036854775807n) throw new Error("Invalid ingestion position");
  return BigInt(value);
}

function roomIdentity(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error("Invalid Workroom identity");
  }
}

// Callers supply rooms admitted by the existing policy boundary. This helper
// grants no access and changes no ownership. One statement freezes every room's
// committed counter in one MVCC snapshot, before taking the cycle WorkItem lock.
export async function freezeActivityWindows(db: Reader, roomIds: readonly string[]): Promise<ActivityWindow[]> {
  if (roomIds.length > 10_000) throw new Error("A review window is bounded to 10000 rooms");
  if (new Set(roomIds).size !== roomIds.length) throw new Error("Review window has duplicate rooms");
  roomIds.forEach(roomIdentity);
  if (roomIds.length === 0) return [];
  const rows = await db.$queryRaw<ActivityWindow[]>(Prisma.sql`
    SELECT id AS "roomId", "activitySequence"::text AS "highWater"
    FROM "WorkCapsule" WHERE id IN (${Prisma.join([...roomIds])})`);
  const byId = new Map(rows.map(row => [row.roomId, row]));
  return roomIds.map(roomId => {
    const row = byId.get(roomId);
    if (!row) throw new Error(`Review window room is missing: ${roomId}`);
    position(row.highWater);
    return row;
  });
}

// Reads consume the persisted boundary, never current time or a fresh counter.
// Allocation gaps are valid; neither gaps nor an empty page establish retention
// coverage. The cycle writer must atomically persist output and consumed position.
export async function readActivityWindowPage(db: Reader, input: {
  roomId: string; after: string; highWater: string; take: number;
}): Promise<{ rows: IngestedActivity[]; coverage: "retention-unverified" }> {
  roomIdentity(input.roomId);
  const after = position(input.after);
  const highWater = position(input.highWater);
  if (after > highWater) throw new Error("Cursor exceeds the frozen boundary");
  if (!Number.isSafeInteger(input.take) || input.take < 1 || input.take > 200) {
    throw new Error("Invalid ingestion page size; expected 1 through 200");
  }
  const rows = await db.$queryRaw<IngestedActivity[]>(Prisma.sql`
    SELECT activity.id, activity."workCapsuleId" AS "roomId", activity."sequence"::text AS "ingestionSequence",
      activity.kind, activity.summary, activity.payload, activity."recordedAt"
    FROM "WorkCapsuleActivity" AS activity
    WHERE activity."workCapsuleId" = ${input.roomId}
      AND activity."sequence" > ${input.after}::bigint
      AND activity."sequence" <= ${input.highWater}::bigint
    ORDER BY activity."sequence" ASC LIMIT ${input.take}`);
  return { rows, coverage: "retention-unverified" };
}
