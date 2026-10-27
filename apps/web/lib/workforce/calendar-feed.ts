// apps/web/lib/workforce/calendar-feed.ts
//
// BI-051A74CE: what a private calendar subscription may carry. The workspace
// calendar merges the whole install's schedule (leave, reviews, money due, CRM,
// compliance, platform jobs); a feed leaves the portal, so it carries only what
// its owner's CURRENT roles may see, deny by default:
//   - the owner's own native events, any category or visibility;
//   - other people's native events only when not private and in a category the
//     owner may see (personal and external imports of others never travel);
//   - projected platform events only in a category the owner may see;
//   - workbook rows never: each workbook is shared per ACL, which a category
//     cannot express.

import { prisma, type Prisma } from "@dpf/db";

import { can, type CapabilityKey, type UserContext } from "@/lib/govern/permissions";
import type { CalendarEventView } from "./calendar-data";

/** Category → the capability that may see it. A category absent here never travels (except own events). */
export const FEED_CATEGORY_CAPABILITIES: Readonly<Record<string, readonly CapabilityKey[]>> = {
  hr: ["view_employee"],
  operations: ["view_operations"],
  platform: ["view_platform"],
  compliance: ["view_compliance"],
  finance: ["view_finance"],
  business: ["view_customer", "view_operations"],
};

export function feedCategoriesFor(user: UserContext): string[] {
  return Object.entries(FEED_CATEGORY_CAPABILITIES)
    .filter(([, capabilities]) => capabilities.some((capability) => can(user, capability)))
    .map(([category]) => category);
}

/** Keep the projected (non-native, non-workbook) events whose category the owner may see. */
export function scopeProjectedFeedEvents(
  events: readonly CalendarEventView[],
  user: UserContext,
): CalendarEventView[] {
  const allowed = new Set(feedCategoriesFor(user));
  return events.filter((event) =>
    event.sourceType === "projected" && event.eventType !== "workbook" && allowed.has(event.category));
}

type NativeFeedDb = Pick<Prisma.TransactionClient, "calendarEvent">;

/** Native events the owner may carry out: their own, plus others' non-private ones in an allowed category. */
export async function loadNativeFeedEvents(
  input: { ownerEmployeeId: string | null; user: UserContext; rangeStart: Date; rangeEnd: Date },
  db: NativeFeedDb = prisma,
): Promise<CalendarEventView[]> {
  const allowed = feedCategoriesFor(input.user);
  const visibleTo: Prisma.CalendarEventWhereInput[] = [];
  if (input.ownerEmployeeId) visibleTo.push({ ownerEmployeeId: input.ownerEmployeeId });
  if (allowed.length > 0) visibleTo.push({ visibility: { not: "private" }, category: { in: allowed } });
  if (visibleTo.length === 0) return [];

  const rows = await db.calendarEvent.findMany({
    where: {
      AND: [
        { startAt: { lte: input.rangeEnd } },
        { OR: [{ endAt: { gte: input.rangeStart } }, { endAt: null, startAt: { gte: input.rangeStart } }] },
        { OR: visibleTo },
      ],
    },
    orderBy: { startAt: "asc" },
    select: { eventId: true, title: true, startAt: true, endAt: true, allDay: true, category: true, eventType: true },
  });
  return rows.map((row) => ({
    id: row.eventId,
    title: row.title,
    start: row.startAt.toISOString(),
    end: row.endAt?.toISOString() ?? null,
    allDay: row.allDay,
    category: row.category,
    eventType: row.eventType,
    color: "",
    editable: false,
    sourceType: "native",
  }));
}

// ─── iCalendar rendering (RFC 5545) ────────────────────────────────────────

export function renderICalendar(events: readonly CalendarEventView[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenDigitalProductFactory//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:DPF Calendar",
  ];

  for (const event of events) {
    const dtStart = event.allDay
      ? `DTSTART;VALUE=DATE:${formatICalDate(event.start)}`
      : `DTSTART:${formatICalDateTime(event.start)}`;
    const dtEnd = event.end
      ? event.allDay
        ? `DTEND;VALUE=DATE:${formatICalDate(event.end)}`
        : `DTEND:${formatICalDateTime(event.end)}`
      : "";

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@dpf`);
    lines.push(dtStart);
    if (dtEnd) lines.push(dtEnd);
    lines.push(`SUMMARY:${escapeICalText(event.title)}`);
    lines.push(`CATEGORIES:${event.category.toUpperCase()}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
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
