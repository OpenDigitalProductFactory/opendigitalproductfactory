// apps/web/app/api/calendar/events/route.ts
// Returns calendar events for a given date range. The data layer automatically
// adjusts density (daily digest / hourly digest / individual events) based on
// the span of the requested range, so the client can simply refetch when the
// FullCalendar view or date range changes.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCalendarEvents } from "@/lib/calendar-data";
import { readNativeCalendarCivilRange } from "@/lib/workforce/native-calendar-range";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const startParam = searchParams.get("start");
  const endParam   = searchParams.get("end");

  if (!startParam || !endParam) {
    return NextResponse.json({ error: "start and end query params required" }, { status: 400 });
  }

  const rangeStart = new Date(startParam);
  const rangeEnd   = new Date(endParam);
  const civilRange = readNativeCalendarCivilRange(
    searchParams.get("civilStart"), searchParams.get("civilEnd"), rangeStart, rangeEnd,
  );

  if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime()) || civilRange === null) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  const events = await getCalendarEvents(rangeStart, rangeEnd, undefined, civilRange);

  return NextResponse.json(events, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
