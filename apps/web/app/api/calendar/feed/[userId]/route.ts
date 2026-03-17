// apps/web/app/api/calendar/feed/[userId]/route.ts
// iCal (.ics) feed endpoint for subscribing from external calendars.

import { NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { getCalendarEvents } from "@/lib/calendar-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  // Validate user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  // Fetch 6 months of events
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 5, 0);
  const events = await getCalendarEvents(rangeStart, rangeEnd, profile?.id);

  // Build iCalendar output
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenDigitalProductFactory//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:DPF Calendar (${user.email})`,
  ];

  for (const event of events) {
    const uid = `${event.id}@dpf`;
    const dtStart = event.allDay
      ? `DTSTART;VALUE=DATE:${formatICalDate(event.start)}`
      : `DTSTART:${formatICalDateTime(event.start)}`;
    const dtEnd = event.end
      ? event.allDay
        ? `DTEND;VALUE=DATE:${formatICalDate(event.end)}`
        : `DTEND:${formatICalDateTime(event.end)}`
      : "";

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(dtStart);
    if (dtEnd) lines.push(dtEnd);
    lines.push(`SUMMARY:${escapeICalText(event.title)}`);
    lines.push(`CATEGORIES:${event.category.toUpperCase()}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=dpf-calendar.ics",
      "Cache-Control": "no-cache, max-age=300",
    },
  });
}

function formatICalDate(iso: string): string {
  return iso.replace(/[-:]/g, "").split("T")[0]!;
}

function formatICalDateTime(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICalText(text: string): string {
  return text.replace(/[\\;,\n]/g, (c) => (c === "\n" ? "\\n" : `\\${c}`));
}
