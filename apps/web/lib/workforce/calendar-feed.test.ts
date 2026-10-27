// BI-051A74CE AC-2: a feed carries only what its owner's roles may see.
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import type { UserContext } from "@/lib/govern/permissions";
import type { CalendarEventView } from "./calendar-data";
import { feedCategoriesFor, loadNativeFeedEvents, renderICalendar, scopeProjectedFeedEvents } from "./calendar-feed";

const member: UserContext = { userId: "u-600", platformRole: "HR-600", platformRoles: ["HR-600"], isSuperuser: false };
const finance: UserContext = { userId: "u-200", platformRole: "HR-200", platformRoles: ["HR-200"], isSuperuser: false };
const admin: UserContext = { userId: "u-su", platformRole: null, platformRoles: [], isSuperuser: true };

function ev(id: string, category: string, extra: Partial<CalendarEventView> = {}): CalendarEventView {
  return {
    id, title: id, start: "2026-10-20T10:00:00.000Z", end: null, allDay: false, category,
    eventType: "x", color: "", editable: false, sourceType: "projected", ...extra,
  };
}

const merged = [
  ev("leave-1", "hr"), ev("invoice-1", "finance"), ev("reg-1", "compliance"),
  ev("booking-1", "business"), ev("job-1", "platform"), ev("rfc-1", "operations"),
  ev("workbook-ROW-1", "business", { eventType: "workbook" }),
  ev("native-1", "personal", { sourceType: "native" }),
  ev("mystery-1", "unclassified"),
];

describe("scopeProjectedFeedEvents", () => {
  it("gives a workforce member (HR-600) no business categories", () => {
    expect(feedCategoriesFor(member)).toEqual([]);
    expect(scopeProjectedFeedEvents(merged, member)).toEqual([]);
  });

  it("gives a role only the categories its capabilities allow", () => {
    expect(scopeProjectedFeedEvents(merged, finance).map((e) => e.id).sort())
      .toEqual(["booking-1", "invoice-1", "job-1", "leave-1", "reg-1"]);
  });

  it("never carries workbook rows, native rows or unknown categories, even for a superuser", () => {
    const ids = scopeProjectedFeedEvents(merged, admin).map((e) => e.id);
    expect(ids).not.toContain("workbook-ROW-1");
    expect(ids).not.toContain("native-1");
    expect(ids).not.toContain("mystery-1");
    expect(ids).toContain("rfc-1");
  });
});

describe("loadNativeFeedEvents", () => {
  const range = { rangeStart: new Date("2026-10-01"), rangeEnd: new Date("2026-11-30") };

  function db() {
    return { calendarEvent: { findMany: vi.fn().mockResolvedValue([]) } };
  }

  it("asks for the owner's own events plus others' non-private ones in allowed categories", async () => {
    const fake = db();
    await loadNativeFeedEvents({ ownerEmployeeId: "emp-200", user: finance, ...range }, fake as never);
    const where = fake.calendarEvent.findMany.mock.calls[0]![0].where;
    expect(where.AND[2].OR).toEqual([
      { ownerEmployeeId: "emp-200" },
      { visibility: { not: "private" }, category: { in: ["hr", "platform", "compliance", "finance", "business"] } },
    ]);
  });

  it("limits a member to their own events", async () => {
    const fake = db();
    await loadNativeFeedEvents({ ownerEmployeeId: "emp-600", user: member, ...range }, fake as never);
    expect(fake.calendarEvent.findMany.mock.calls[0]![0].where.AND[2].OR).toEqual([{ ownerEmployeeId: "emp-600" }]);
  });

  it("returns nothing, without a query, for a member with no employee profile", async () => {
    const fake = db();
    expect(await loadNativeFeedEvents({ ownerEmployeeId: null, user: member, ...range }, fake as never)).toEqual([]);
    expect(fake.calendarEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("renderICalendar", () => {
  it("renders RFC 5545 lines and escapes text, with no owner identity in the calendar name", () => {
    const ics = renderICalendar([ev("a", "finance", { title: "Pay, now; ok", allDay: true })]);
    expect(ics.split("\r\n")).toEqual(expect.arrayContaining([
      "BEGIN:VCALENDAR", "X-WR-CALNAME:DPF Calendar", "UID:a@dpf",
      "DTSTART;VALUE=DATE:20261020", "SUMMARY:Pay\\, now\\; ok", "CATEGORIES:FINANCE", "END:VCALENDAR",
    ]));
  });
});
