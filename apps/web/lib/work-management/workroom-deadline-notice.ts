import "server-only";

// A graph room's stage passed its deadline: tell whoever escalation names
// (BI-8875C9DF, GPP Phase 3c PR-3c-4). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §8.
//
// The deadline never moves the work; this notice is its only effect besides
// the attention inbox (lib/attention/sources/workroom-stall.ts). The target is
// the stage gate's escalation role, else the stage's accountable principal,
// named in the notice and delivered through the room-owner fallback the stall
// notice uses (workroom-stall-notice.ts): the room's owner, else the operator.
//
// Returns true only when the notification was written or an unread one for
// the same notice already exists. No recipient, or a failed write, returns
// false, so the drive leaves the notice unsent and retries on its next tick.

import { notifyAttentionLiveOrThrow, resolveOperatorRecipient } from "@/lib/attention/notify-live";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";

import type { PendingDeadlineNotice } from "./drive-deadlines";

export async function notifyWorkroomDeadline(input: {
  room: { capsuleId: string; ownerUserId: string | null };
  notice: PendingDeadlineNotice;
  now: Date;
}): Promise<boolean> {
  try {
    const userId = input.room.ownerUserId ?? await resolveOperatorRecipient();
    if (!userId) return false;
    const { notice } = input;
    const deepLink = `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: input.room.capsuleId })}`;
    await notifyAttentionLiveOrThrow({
      source: "workroom-stall",
      itemKey: `${input.room.capsuleId}:deadline:${notice.key}`,
      userId,
      title: `${input.room.capsuleId}: stage ${notice.stageTitle} is past its deadline`,
      body:
        `Stage ${notice.stageTitle} (${notice.stageKey}) passed its deadline (${notice.description}; ${notice.afterDays} day${notice.afterDays === 1 ? "" : "s"}). ` +
        `It waits on ${notice.escalationRef}. The work has not been moved: it stays at this stage until the stage is done or someone decides on it.`,
      deepLink,
      riskClass: "read",
    });
    return true;
  } catch {
    return false;
  }
}
