// Standing rooms and their rhythm for /ops/workrooms (Work Atlas A4, BI-D8A6F0F2).
//
// Two bounded reads: the live standing rooms, then their drive log rows for the
// rhythm window. A third, one row per room, finds whether a run was recorded
// before the window, so a quiet stretch inside the window reads as missed
// rather than as "no record".

import type { prisma } from "@dpf/db";

import { isRecord } from "@/lib/shared/coerce";
import { TERMINAL_WORKROOM_STATUSES } from "./standing-room-nesting";
import { classifyStandingRhythm, RHYTHM_WINDOW_DAYS, type DriveRunRow, type StandingRhythm } from "./standing-run-history";
import { WORKROOM_DRIVE_ACTIVITY_KIND, WORKROOM_DRIVE_ATTENTION_KIND } from "./workroom-drive-constants";

type Db = Pick<typeof prisma, "workroom" | "workroomActivity">;

/** Standing rooms read for one render; the estate declares about twenty. */
export const STANDING_RHYTHM_ROOM_LIMIT = 100;
/** Drive rows read for the window; a room writes a row only when its hold changes. */
const DRIVE_ROW_LIMIT = 5_000;
const DRIVE_KINDS = [WORKROOM_DRIVE_ACTIVITY_KIND, WORKROOM_DRIVE_ATTENTION_KIND];

export type StandingRhythmRow = {
  capsuleId: string;
  title: string;
  rhythm: StandingRhythm;
};

function runRow(payload: unknown, recordedAt: Date): DriveRunRow | null {
  if (!isRecord(payload) || typeof payload.runKey !== "string") return null;
  return {
    runKey: payload.runKey,
    action: typeof payload.action === "string" ? payload.action : "",
    reason: typeof payload.reason === "string" ? payload.reason : "",
    recordedAt,
  };
}

function snapshotRunKey(workspaceState: unknown): string | null {
  const drive = isRecord(workspaceState) && isRecord(workspaceState.workroomDrive) ? workspaceState.workroomDrive : null;
  return drive && typeof drive.runKey === "string" ? drive.runKey : null;
}

export async function loadStandingRhythms(db: Db, now = new Date()): Promise<StandingRhythmRow[]> {
  const rooms = await db.workroom.findMany({
    where: {
      archivedAt: null,
      idempotencyKey: { startsWith: "standing-room:" },
      status: { notIn: [...TERMINAL_WORKROOM_STATUSES] },
    },
    select: { id: true, capsuleId: true, title: true, workspaceState: true },
    orderBy: { title: "asc" },
    take: STANDING_RHYTHM_ROOM_LIMIT,
  });
  if (rooms.length === 0) return [];
  const ids = rooms.map((room) => room.id);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const windowStart = new Date(today - (RHYTHM_WINDOW_DAYS - 1) * 86_400_000);

  const [rows, earlier] = await Promise.all([
    db.workroomActivity.findMany({
      where: { workCapsuleId: { in: ids }, kind: { in: DRIVE_KINDS }, recordedAt: { gte: windowStart } },
      select: { workCapsuleId: true, payload: true, recordedAt: true },
      orderBy: { recordedAt: "asc" },
      take: DRIVE_ROW_LIMIT,
    }),
    db.workroomActivity.findMany({
      where: {
        workCapsuleId: { in: ids },
        kind: { in: DRIVE_KINDS },
        recordedAt: { lt: windowStart },
        payload: { path: ["runKey"], string_contains: ":" },
      },
      select: { workCapsuleId: true, recordedAt: true },
      orderBy: { recordedAt: "asc" },
      distinct: ["workCapsuleId"],
    }),
  ]);

  const rowsByRoom = new Map<string, DriveRunRow[]>();
  for (const row of rows) {
    const run = runRow(row.payload, row.recordedAt);
    if (!run) continue;
    rowsByRoom.set(row.workCapsuleId, [...(rowsByRoom.get(row.workCapsuleId) ?? []), run]);
  }
  const historyFrom = new Map(earlier.map((row) => [row.workCapsuleId, row.recordedAt.toISOString().slice(0, 10)]));

  return rooms.map((room) => ({
    capsuleId: room.capsuleId,
    title: room.title,
    rhythm: classifyStandingRhythm({
      rows: rowsByRoom.get(room.id) ?? [],
      currentRunKey: snapshotRunKey(room.workspaceState),
      historyFrom: historyFrom.get(room.id) ?? null,
      now,
    }),
  }));
}
