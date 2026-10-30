// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Calendar } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/govern/permissions", () => ({ can: () => false }));

import { loadNativeFeedEvents } from "@/lib/workforce/calendar-feed";
import { CalendarDetailPopover } from "./CalendarDetailPopover";

afterEach(() => vi.unstubAllEnvs());

async function fixture(start: string, end: string | null, allDay: boolean, syncSource: string | null = null) {
  const findMany = vi.fn().mockResolvedValue([{ eventId: "CE-FIXTURE", title: "Civil date fixture",
    startAt: new Date(start), endAt: end ? new Date(end) : null,
    allDay, category: "business", eventType: "reminder", syncSource }]);
  const [event] = await loadNativeFeedEvents({ ownerEmployeeId: "fixture-employee", user: { platformRole: null, isSuperuser: false },
    rangeStart: new Date("2026-01-01T00:00:00Z"), rangeEnd: new Date("2027-01-01T00:00:00Z") },
  { calendarEvent: { findMany } } as never);
  return event!;
}

describe("native all-day calendar roundtrip (BI-E815393C)", () => {
  for (const [zone, day] of [
    ["America/Chicago", "2026-10-29"], ["America/Chicago", "2026-03-08"],
    ["America/Los_Angeles", "2026-11-01"], ["Pacific/Kiritimati", "2026-10-29"],
    ["Pacific/Honolulu", "2026-10-29"],
  ]) {
    it(`keeps selected/grid/detail day in ${zone} on ${day}`, async () => {
      vi.stubEnv("TZ", zone!);
      const event = await fixture(`${day}T00:00:00.000Z`, null, true);
      const el = document.createElement("div");
      document.body.appendChild(el);
      const calendar = new Calendar(el, { plugins: [dayGridPlugin], initialView: "dayGridMonth",
        initialDate: day, timeZone: "local", events: [{ ...event, end: event.end ?? undefined }] });
      try {
        calendar.render();
        const parsed = calendar.getEventById(event.id)!;
        expect(parsed.startStr).toBe(day);
        const detail = renderToStaticMarkup(<CalendarDetailPopover
          event={{ ...event, start: parsed.startStr, end: parsed.endStr || null }}
          anchorRect={{ top: 0, left: 0, width: 100, height: 20 }} onClose={() => {}} />);
        const expected = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T00:00:00Z`));
        expect(detail).toContain(expected);
        expect(event.start).toBe(day);
      } finally { calendar.destroy(); el.remove(); }
    });
  }

  it("shows the last included day for a multi-day exclusive end", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    const event = await fixture("2026-10-29T00:00:00Z", "2026-10-31T00:00:00Z", true);
    const detail = renderToStaticMarkup(<CalendarDetailPopover event={event}
      anchorRect={{ top: 0, left: 0, width: 100, height: 20 }} onClose={() => {}} />);
    expect(detail).toContain("Oct 29");
    expect(detail).toContain("Oct 30");
    expect(detail).not.toContain("Oct 31");
  });

  it("retains timed instants and their legitimate local day conversion", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    const event = await fixture("2026-10-29T01:30:00Z", null, false);
    expect(event.start).toBe("2026-10-29T01:30:00.000Z");
    const detail = renderToStaticMarkup(<CalendarDetailPopover event={event}
      anchorRect={{ top: 0, left: 0, width: 100, height: 20 }} onClose={() => {}} />);
    expect(detail).toContain("Oct 28");
  });
  it("does not reinterpret imported all-day timestamp storage", async () => {
    const event = await fixture("2026-10-29T10:00:00Z", null, true, "external");
    expect(event.start).toBe("2026-10-29T10:00:00.000Z");
  });
});
