import { describe, it, expect } from "vitest";
import {
  monthGrid,
  monthLabel,
  shiftMonth,
  cellDayKey,
  bucketRowsByDay,
  dateColumns,
  WEEKDAY_LABELS,
} from "./grid-calendar";
import type { GridRowData } from "./cell-editors";
import type { ColumnDefinition } from "@/lib/workbooks/types";

describe("monthGrid", () => {
  // July 2026: month index 6. July 1 2026 is a Wednesday.
  const weeks = monthGrid(2026, 6);

  it("is a 6×7 matrix", () => {
    expect(weeks).toHaveLength(6);
    for (const w of weeks) expect(w).toHaveLength(7);
  });

  it("starts on the Sunday on/before the 1st and marks out-of-month days", () => {
    // First cell is Sun Jun 28 2026 (leading days from June).
    expect(weeks[0]![0]).toEqual({ key: "2026-06-28", day: 28, inMonth: false });
    // July 1 lands in column 3 (Wednesday).
    expect(weeks[0]![3]).toEqual({ key: "2026-07-01", day: 1, inMonth: true });
  });

  it("marks trailing days as out-of-month", () => {
    const last = weeks[5]![6]!;
    expect(last.inMonth).toBe(false); // early August
  });

  it("contains every day of the month exactly once", () => {
    const inMonth = weeks.flat().filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31); // July has 31 days
    expect(inMonth[0]!.key).toBe("2026-07-01");
    expect(inMonth[30]!.key).toBe("2026-07-31");
  });
});

describe("monthLabel / shiftMonth", () => {
  it("labels the month", () => {
    expect(monthLabel(2026, 6)).toBe("July 2026");
    expect(monthLabel(2026, 0)).toBe("January 2026");
  });

  it("shifts forward across a year boundary", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it("shifts backward across a year boundary", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it("shifts by many months", () => {
    expect(shiftMonth(2026, 6, 12)).toEqual({ year: 2027, month: 6 });
  });

  it("provides Sunday-first weekday labels", () => {
    expect(WEEKDAY_LABELS[0]).toBe("Sun");
    expect(WEEKDAY_LABELS).toHaveLength(7);
  });
});

describe("cellDayKey", () => {
  it("slices an ISO date without timezone drift", () => {
    expect(cellDayKey("2026-07-01")).toBe("2026-07-01");
    expect(cellDayKey("2026-07-01T23:30:00.000Z")).toBe("2026-07-01");
  });

  it("returns null for blank / non-date values", () => {
    expect(cellDayKey(null)).toBeNull();
    expect(cellDayKey("")).toBeNull();
    expect(cellDayKey("not a date")).toBeNull();
    expect(cellDayKey(true)).toBeNull();
  });
});

describe("bucketRowsByDay", () => {
  const rows: GridRowData[] = [
    { rowId: "1", due: "2026-07-01" },
    { rowId: "2", due: "2026-07-01T09:00:00Z" },
    { rowId: "3", due: "2026-07-04" },
    { rowId: "4", due: "" }, // undated — dropped
  ];

  it("buckets rows onto their day, dropping undated rows", () => {
    const map = bucketRowsByDay(rows, "due");
    expect(map.get("2026-07-01")!.map((r) => r.rowId)).toEqual(["1", "2"]);
    expect(map.get("2026-07-04")!.map((r) => r.rowId)).toEqual(["3"]);
    expect(map.size).toBe(2);
  });
});

describe("dateColumns", () => {
  const col = (columnId: string, fieldType: ColumnDefinition["fieldType"]): ColumnDefinition => ({
    columnId,
    name: columnId,
    fieldType,
    position: 0,
    required: false,
    editable: true,
  });

  it("keeps only date and datetime columns", () => {
    const cols = [col("a", "text"), col("b", "date"), col("c", "datetime"), col("d", "number")];
    expect(dateColumns(cols).map((c) => c.columnId)).toEqual(["b", "c"]);
  });
});
