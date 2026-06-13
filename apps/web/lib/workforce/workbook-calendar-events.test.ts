import { describe, it, expect } from "vitest";
import { buildWorkbookEvents, type WorkbookEventInput } from "./workbook-calendar-events";

describe("buildWorkbookEvents", () => {
  it("projects a date-column row as an all-day event titled table: label", () => {
    const inputs: WorkbookEventInput[] = [
      { tableName: "Site Visits", rowId: "ROW-1", dateISO: "2026-07-01T00:00:00.000Z", title: "North Depot", withTime: false },
    ];
    expect(buildWorkbookEvents(inputs)).toEqual([
      {
        id: "workbook-ROW-1",
        title: "Site Visits: North Depot",
        start: "2026-07-01T00:00:00.000Z",
        end: null,
        allDay: true,
        category: "business",
        eventType: "workbook",
        color: "#14b8a6",
        editable: false,
        sourceType: "projected",
        sourceId: "ROW-1",
      },
    ]);
  });

  it("uses a timed event for datetime columns and (untitled) when no label", () => {
    const [ev] = buildWorkbookEvents([
      { tableName: "Tasks", rowId: "ROW-2", dateISO: "2026-07-02T14:30:00.000Z", title: null, withTime: true },
    ]);
    expect(ev.allDay).toBe(false);
    expect(ev.title).toBe("Tasks: (untitled)");
  });

  it("trims blank titles to (untitled)", () => {
    const [ev] = buildWorkbookEvents([
      { tableName: "T", rowId: "ROW-3", dateISO: "2026-07-03T00:00:00.000Z", title: "   ", withTime: false },
    ]);
    expect(ev.title).toBe("T: (untitled)");
  });
});
