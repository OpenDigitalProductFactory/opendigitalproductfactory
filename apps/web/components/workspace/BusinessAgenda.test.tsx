import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BusinessAgenda, isBusinessAgendaEvent } from "./BusinessAgenda";
import type { CalendarEventView } from "@/lib/calendar-data";

const NOW = new Date("2026-06-10T12:00:00.000Z");

function ev(partial: Partial<CalendarEventView> & Pick<CalendarEventView, "id" | "title" | "start" | "category" | "eventType">): CalendarEventView {
  return {
    end: null,
    allDay: false,
    color: "#14b8a6",
    editable: false,
    sourceType: "projected",
    ...partial,
  };
}

const events: CalendarEventView[] = [
  ev({ id: "b1", title: "Patel booking", start: "2026-06-10T15:00:00.000Z", category: "business", eventType: "booking" }),
  ev({ id: "f1", title: "Acme invoice due", start: "2026-06-11T00:00:00.000Z", category: "finance", eventType: "invoice", allDay: true }),
  // platform/ops minutia — must never appear on the business agenda
  ev({ id: "p1", title: "Nightly backup digest", start: "2026-06-10T13:00:00.000Z", category: "platform", eventType: "recurring-digest" }),
  ev({ id: "p2", title: "Deploy window", start: "2026-06-10T20:00:00.000Z", category: "operations", eventType: "deployment-window" }),
  ev({ id: "a1", title: "Coworker task run", start: "2026-06-10T14:00:00.000Z", category: "platform", eventType: "agent-task" }),
  // past event — before today's cutoff
  ev({ id: "old", title: "Last week booking", start: "2026-06-01T15:00:00.000Z", category: "business", eventType: "booking" }),
];

describe("isBusinessAgendaEvent", () => {
  it("keeps business-context events and rejects platform/ops minutia", () => {
    expect(isBusinessAgendaEvent({ category: "business", eventType: "booking" })).toBe(true);
    expect(isBusinessAgendaEvent({ category: "finance", eventType: "invoice" })).toBe(true);
    expect(isBusinessAgendaEvent({ category: "platform", eventType: "recurring-digest" })).toBe(false);
    expect(isBusinessAgendaEvent({ category: "operations", eventType: "deployment-window" })).toBe(false);
    expect(isBusinessAgendaEvent({ category: "platform", eventType: "agent-task" })).toBe(false);
    expect(isBusinessAgendaEvent({ category: "business", eventType: "operating-hours" })).toBe(false);
  });
});

describe("BusinessAgenda", () => {
  it("shows upcoming business events and excludes platform/ops events", () => {
    const html = renderToStaticMarkup(<BusinessAgenda events={events} now={NOW} />);

    expect(html).toContain("Today &amp; next");
    expect(html).toContain("Patel booking");
    expect(html).toContain("Acme invoice due");
    // platform minutia and past events are absent
    expect(html).not.toContain("Nightly backup digest");
    expect(html).not.toContain("Deploy window");
    expect(html).not.toContain("Coworker task run");
    expect(html).not.toContain("Last week booking");
  });

  // The empty state used to offer "Add a booking, invoice, or appointment" and
  // link to the business calendar, which makes none of those three (BI-460BFA84).
  it("promises only what the calendar it links to can actually do", () => {
    const html = renderToStaticMarkup(<BusinessAgenda events={[]} />);
    expect(html).not.toContain("Add a booking, invoice, or appointment");
    expect(html).toContain("Add something to the calendar");
  });

  it("renders an empty state (no synthesized rows) when there are no business events", () => {
    const html = renderToStaticMarkup(<BusinessAgenda events={[]} now={NOW} />);

    expect(html).toContain("Nothing scheduled for the business right now.");
  });

  it("renders an empty state when only platform events exist", () => {
    const onlyPlatform = events.filter((e) => e.category === "platform" || e.category === "operations");
    const html = renderToStaticMarkup(<BusinessAgenda events={onlyPlatform} now={NOW} />);

    expect(html).toContain("Nothing scheduled for the business right now.");
  });
});
