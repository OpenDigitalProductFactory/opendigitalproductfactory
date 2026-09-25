// Workrooms the drive is holding, for the operations surface (BI-E8C78E80).
//
// A room paused or escalated by its drive used to be visible only inside the
// room, as "Checked <time>". Nothing listed the held rooms together, or said
// why each was held and for how long, so a room could sit in conformance_pause
// for days unseen. This reads the drive's own snapshot (the hold it now keeps)
// from each live room: one bounded query, no activity scan.

import type { prisma } from "@dpf/db";

import { isRecord } from "@/lib/shared/coerce";

import { driveDeviationCodes, readDriveHold } from "./workroom-drive-hold";

type Db = Pick<typeof prisma, "workroom">;

export const HELD_WORKROOM_LIMIT = 100;

export type HeldWorkroomRow = {
  capsuleId: string;
  title: string;
  action: "pause" | "escalate";
  reason: string;
  deviationCodes: string[];
  stageKey: string | null;
  /** When the room last stopped advancing; the last tick when no hold was recorded yet. */
  since: string | null;
  /** Consecutive 15-minute ticks without advancing, when the hold records it. */
  stuckTicks: number | null;
  notifiedAt: string | null;
};

export async function loadHeldWorkrooms(db: Db, limit = HELD_WORKROOM_LIMIT): Promise<HeldWorkroomRow[]> {
  const rooms = await db.workroom.findMany({
    where: {
      archivedAt: null,
      status: { notIn: ["abandoned", "archived", "complete"] },
      OR: [
        { workspaceState: { path: ["workroomDrive", "action"], equals: "pause" } },
        { workspaceState: { path: ["workroomDrive", "action"], equals: "escalate" } },
      ],
    },
    select: { capsuleId: true, title: true, workspaceState: true },
    take: limit,
  });
  return rooms.flatMap((room): HeldWorkroomRow[] => {
    const drive = isRecord(room.workspaceState) && isRecord(room.workspaceState.workroomDrive)
      ? room.workspaceState.workroomDrive : null;
    const action = drive?.action;
    if (!drive || (action !== "pause" && action !== "escalate")) return [];
    const hold = readDriveHold(room.workspaceState);
    return [{
      capsuleId: room.capsuleId,
      title: room.title,
      action,
      reason: typeof drive.reason === "string" ? drive.reason : "unknown",
      deviationCodes: driveDeviationCodes(drive.conformance),
      stageKey: typeof drive.stageKey === "string" ? drive.stageKey : null,
      since: hold?.stuckSince ?? (typeof drive.lastRunAt === "string" ? drive.lastRunAt : null),
      stuckTicks: hold ? hold.stuckTicks : null,
      notifiedAt: hold?.notifiedAt ?? null,
    }];
  }).sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
}
