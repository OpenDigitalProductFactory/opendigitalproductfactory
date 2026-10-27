// apps/web/lib/actions/calendar-feed.ts
// BI-051A74CE: the signed-in user manages their OWN private calendar
// subscription link. Each action acts only on the session user; there is no
// parameter naming whose link to change.
"use server";

import { auth } from "@/lib/auth";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import {
  calendarFeedPath,
  getCalendarFeedTokenIssuedAt,
  revokeCalendarFeedToken,
  rotateCalendarFeedToken,
} from "@/lib/workforce/calendar-feed-token";

export type CalendarFeedStatus = { active: boolean; issuedAt: string | null };

export async function getCalendarFeedStatus(): Promise<ActionResult<CalendarFeedStatus>> {
  const session = await auth();
  if (!session?.user?.id) return err("Unauthorized");
  const issuedAt = await getCalendarFeedTokenIssuedAt(session.user.id);
  return ok({ active: issuedAt !== null, issuedAt: issuedAt?.toISOString() ?? null });
}

/** Create or replace the link. The returned path holds the token and is shown once. */
export async function rotateCalendarFeed(): Promise<ActionResult<{ path: string }>> {
  const session = await auth();
  if (!session?.user?.id) return err("Unauthorized");
  const token = await rotateCalendarFeedToken(session.user.id);
  return ok({ path: calendarFeedPath(session.user.id, token) });
}

export async function revokeCalendarFeed(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return err("Unauthorized");
  await revokeCalendarFeedToken(session.user.id);
  return ok();
}
