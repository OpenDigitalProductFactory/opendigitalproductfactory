import "server-only";

// A room stuck for an hour follows its recorded recovery route, once (BI-E8C78E80).
//
// The workroom-stall attention source already lists a stuck room in the inbox,
// but only for someone who opens it; a room could refuse every wake for days
// without anyone being told. The drive now pushes one notification per stuck
// spell to the route's named person through the existing attention notifier.
// Missing recipients and failed writes throw so the drive keeps the notice unsent.

import { prisma } from "@dpf/db";
import { notifyAttentionLiveOrThrow } from "@/lib/attention/notify-live";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";

import { driveDeviationCodes, type WorkroomDriveHold } from "./workroom-drive-hold";
import { resolveNestedRoomStallRecipient } from "./nested-room-coordination.server";

export async function notifyWorkroomStall(input: {
  room: { id: string; capsuleId: string; ownerUserId: string | null };
  hold: WorkroomDriveHold;
  reason: string;
  conformance: unknown;
}): Promise<void> {
  const userId = await resolveNestedRoomStallRecipient(prisma as never, { roomId: input.room.id });
  if (!userId) throw new Error("workroom-stall-recipient-not-recorded");
  const codes = driveDeviationCodes(input.conformance);
  const why = codes.length > 0 ? codes.join(", ") : input.reason;
  const since = input.hold.stuckSince ?? input.hold.since;
  const deepLink = `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: input.room.capsuleId })}`;
  await notifyAttentionLiveOrThrow({
    source: "workroom-stall",
    itemKey: `${input.room.capsuleId}:${since}`,
    userId,
    title: `${input.room.capsuleId} has not moved for an hour`,
    body: `It has refused ${input.hold.stuckTicks} consecutive wakes since ${since}: ${why}. It will keep refusing until this is resolved.`,
    deepLink,
    riskClass: "read",
  });
}
