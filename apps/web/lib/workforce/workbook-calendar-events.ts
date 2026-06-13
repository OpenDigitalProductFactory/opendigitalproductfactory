// Workbook → calendar projection (EP-GRID-WORKBOOKS × calendar integration)
//
// Pure builder that turns workbook rows carrying a date/datetime column into
// calendar events, so a user's grid with a "Due date" (or any date) column shows
// up on the workspace calendar. Kept pure + unit-testable; the server projection
// in calendar-data.ts does the (EAV) querying and calls this.

import type { CalendarEventView } from "./calendar-data";

export interface WorkbookEventInput {
  /** Owning table's display name (event title prefix). */
  tableName: string;
  /** Semantic row id (ROW-*), used as the stable event id + sourceId. */
  rowId: string;
  /** ISO date string from the row's date/datetime cell. */
  dateISO: string;
  /** A human label for the row (its title column), if any. */
  title: string | null;
  /** datetime column → timed event; date column → all-day. */
  withTime: boolean;
}

const WORKBOOK_EVENT_COLOR = "#14b8a6"; // business category

/** Build calendar events from workbook date-column rows. */
export function buildWorkbookEvents(inputs: WorkbookEventInput[]): CalendarEventView[] {
  return inputs.map((i) => ({
    id: `workbook-${i.rowId}`,
    title: `${i.tableName}: ${i.title?.trim() || "(untitled)"}`,
    start: i.dateISO,
    end: null,
    allDay: !i.withTime,
    category: "business",
    eventType: "workbook",
    color: WORKBOOK_EVENT_COLOR,
    editable: false,
    sourceType: "projected",
    sourceId: i.rowId,
  }));
}
