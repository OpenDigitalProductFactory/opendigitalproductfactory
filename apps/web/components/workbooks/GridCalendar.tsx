"use client";

// Universal Grid & Workbooks — calendar view (EP-GRID-WORKBOOKS).
//
// A dependency-free month calendar over a date/datetime column: each loaded row
// sits on its day cell as a chip; click a chip to open the record. Month nav +
// which-date-column selection live here; the bucketing/matrix math is the pure
// grid-calendar.ts. The Grid mounts this in place of the data grid when the user
// picks the Calendar view (only offered when the table has a date column).

import { useMemo, useState, type ReactNode } from "react";
import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";
import {
  monthGrid,
  monthLabel,
  shiftMonth,
  bucketRowsByDay,
  dateToKey,
  dateColumns,
  WEEKDAY_LABELS,
} from "./grid-calendar";

export interface GridCalendarProps {
  rows: GridRowData[];
  columns: ColumnDefinition[];
  /** Open the record modal for a row (the calendar chip's click target). */
  onOpenRow: (rowId: string) => void;
}

const CTRL =
  "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]";
const NAV_BTN =
  "rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]";

export function GridCalendar({ rows, columns, onOpenRow }: GridCalendarProps): ReactNode {
  const dateCols = dateColumns(columns);
  const [dateColumnId, setDateColumnId] = useState(dateCols[0]?.columnId ?? "");
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const todayKey = dateToKey(now);

  const activeDateCol = dateColumnId || dateCols[0]?.columnId || "";
  // Chip label: the first column that isn't the date axis (usually the title).
  const labelCol = columns.find((c) => c.columnId !== activeDateCol) ?? columns[0];

  const weeks = useMemo(() => monthGrid(ym.year, ym.month), [ym]);
  const byDay = useMemo(
    () => (activeDateCol ? bucketRowsByDay(rows, activeDateCol) : new Map<string, GridRowData[]>()),
    [rows, activeDateCol],
  );

  if (dateCols.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--dpf-border)] p-8 text-center text-sm text-[var(--dpf-muted)]">
        Add a date column to use the calendar.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setYm((v) => shiftMonth(v.year, v.month, -1))} className={NAV_BTN} aria-label="Previous month">
          ‹
        </button>
        <span className="min-w-40 text-center text-sm font-medium text-[var(--dpf-text)]">
          {monthLabel(ym.year, ym.month)}
        </span>
        <button type="button" onClick={() => setYm((v) => shiftMonth(v.year, v.month, 1))} className={NAV_BTN} aria-label="Next month">
          ›
        </button>
        <button
          type="button"
          onClick={() => setYm({ year: now.getFullYear(), month: now.getMonth() })}
          className={NAV_BTN}
        >
          Today
        </button>
        {dateCols.length > 1 && (
          <>
            <span className="ml-2 text-sm text-[var(--dpf-muted)]">Date</span>
            <select
              value={activeDateCol}
              onChange={(e) => setDateColumnId(e.target.value)}
              aria-label="Calendar date column"
              className={CTRL}
            >
              {dateCols.map((c) => (
                <option key={c.columnId} value={c.columnId}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="dpf-calendar-weekhead">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="dpf-calendar-weekhead-cell">
              {w}
            </div>
          ))}
        </div>
        <div className="dpf-calendar-grid">
          {weeks.flat().map((d) => {
            const dayRows = byDay.get(d.key) ?? [];
            return (
              <div
                key={d.key}
                className={`dpf-calendar-cell${d.inMonth ? "" : " dpf-calendar-cell-muted"}${
                  d.key === todayKey ? " dpf-calendar-cell-today" : ""
                }`}
              >
                <div className="dpf-calendar-daynum">{d.day}</div>
                <div className="dpf-calendar-events">
                  {dayRows.map((row) => (
                    <button
                      key={row.rowId}
                      type="button"
                      onClick={() => onOpenRow(row.rowId)}
                      className="dpf-calendar-event"
                      title={labelCol ? cellSearchText(row[labelCol.columnId] ?? null) : row.rowId}
                    >
                      {labelCol ? cellSearchText(row[labelCol.columnId] ?? null) || "(untitled)" : row.rowId}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
