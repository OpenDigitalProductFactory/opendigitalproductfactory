// Universal Grid & Workbooks — calendar view (EP-GRID-WORKBOOKS Phase 4).
//
// A month-grid calendar over a date/datetime column: each row lands on its day
// cell. Dependency-free — a 6-week matrix built from native Date plus a
// timezone-safe day-key parser (ISO date strings are sliced, never Date-parsed,
// so a "2026-07-01" never slips to Jun 30 in a behind-UTC zone). Pure +
// unit-testable; the GridCalendar component owns the rendering and month nav.

import { type CellValue, type ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";

export interface CalendarDay {
  /** Day key, YYYY-MM-DD (local). */
  key: string;
  /** Day of the month, 1–31. */
  day: number;
  /** False for the leading/trailing days borrowed from adjacent months. */
  inMonth: boolean;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local YYYY-MM-DD for a Date (e.g. today's key for the "today" highlight). */
export function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "July 2026" for a 0-based month. */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

/** Move `delta` months from (year, month), wrapping the year. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * A 6-row × 7-column month matrix (Sunday-first) for a 0-based `month`, including
 * the leading/trailing days needed to fill complete weeks.
 */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay()); // back up to Sunday
  const weeks: CalendarDay[][] = [];
  const cursor = start;
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ key: dateToKey(cursor), day: cursor.getDate(), inMonth: cursor.getMonth() === month });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * The local day key (YYYY-MM-DD) for a cell value, or null if it isn't a date.
 * ISO-ish strings are sliced (timezone-safe); anything else is parsed via Date.
 */
export function cellDayKey(value: CellValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1]!;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : dateToKey(d);
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : dateToKey(d);
  }
  return null;
}

/** Bucket rows by the day key of their `dateColumnId` value (undated rows dropped). */
export function bucketRowsByDay(
  rows: readonly GridRowData[],
  dateColumnId: string,
): Map<string, GridRowData[]> {
  const out = new Map<string, GridRowData[]>();
  for (const row of rows) {
    const key = cellDayKey(row[dateColumnId] ?? null);
    if (!key) continue;
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  return out;
}

/** Date/datetime columns eligible to drive the calendar. */
export function dateColumns(columns: ColumnDefinition[]): ColumnDefinition[] {
  return columns.filter((c) => c.fieldType === "date" || c.fieldType === "datetime");
}
