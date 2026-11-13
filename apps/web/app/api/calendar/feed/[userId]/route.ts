// apps/web/app/api/calendar/feed/[userId]/route.ts
// iCal (.ics) feed endpoint for subscribing from external calendars.
//
// BI-051A74CE: a calendar app cannot hold a session, so this route is public,
// and the request must carry the owner's private feed token (`?token=`). Any
// mismatch — no token, a malformed, rotated, revoked or foreign token, a token
// for a different user, an inactive owner — answers the same 404, so the route
// reveals neither whether the user exists nor why it refused.

import { NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { getCalendarEvents } from "@/lib/calendar-data";
import { resolveCalendarFeedOwner } from "@/lib/workforce/calendar-feed-token";
import {
  loadNativeFeedEvents,
  renderICalendar,
  scopeProjectedFeedEvents,
} from "@/lib/workforce/calendar-feed";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const token = new URL(request.url).searchParams.get("token");

  const owner = await resolveCalendarFeedOwner(userId, token);
  if (!owner) return NOT_FOUND();

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: owner.userId },
    select: { id: true },
  });

  // Last month plus the next five.
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 5, 0);

  const [projected, native] = await Promise.all([
    getCalendarEvents(rangeStart, rangeEnd).then((events) => scopeProjectedFeedEvents(events, owner.context)),
    loadNativeFeedEvents({ ownerEmployeeId: profile?.id ?? null, user: owner.context, rangeStart, rangeEnd }),
  ]);
  const events = [...native, ...projected]
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return new Response(renderICalendar(events), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=dpf-calendar.ics",
      "Cache-Control": "private, no-store",
    },
  });
}
