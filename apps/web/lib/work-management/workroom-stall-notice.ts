import "server-only";

// A room stuck for an hour tells its owner, once (BI-E8C78E80).
//
// The workroom-stall attention source already lists a stuck room in the inbox,
// but only for someone who opens it; a room could refuse every wake for days
// without anyone being told. The drive now pushes one notification per stuck
// spell to the room's owner (the operator when the room has none), through the
// existing attention notifier, which also skips a duplicate while one is unread.

import { notifyAttentionLive, resolveOperatorRecipient } from "@/lib/attention/notify-live";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";

import { driveDeviationCodes, type WorkroomDriveHold } from "./workroom-drive-hold";

export async function notifyWorkroomStall(input: {
  room: { capsuleId: string; ownerUserId: string | null };
  hold: WorkroomDriveHold;
  reason: string;
  conformance: unknown;
}): Promise<void> {
  const userId = input.room.ownerUserId ?? await resolveOperatorRecipient();
  if (!userId) return;
  const codes = driveDeviationCodes(input.conformance);
  const why = codes.length > 0 ? codes.join(", ") : input.reason;
  const since = input.hold.stuckSince ?? input.hold.since;
  const deepLink = `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: input.room.capsuleId })}`;
  await notifyAttentionLive({
    source: "workroom-stall",
    itemKey: `${input.room.capsuleId}:${since}`,
    userId,
    title: `${input.room.capsuleId} has not moved for an hour`,
    body: `It has refused ${input.hold.stuckTicks} consecutive wakes since ${since}: ${why}. It will keep refusing until this is resolved.`,
    deepLink,
    riskClass: "read",
  });
}
