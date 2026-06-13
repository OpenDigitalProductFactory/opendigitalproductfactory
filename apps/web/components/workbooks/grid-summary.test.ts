import { describe, it, expect } from "vitest";
import { summarize, toSummaryNumber, numericColumns, summaryChartBars } from "./grid-summary";
import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";

const rows: GridRowData[] = [
  { rowId: "1", status: "open", amount: 100 },
  { rowId: "2", status: "open", amount: 50 },
  { rowId: "3", status: "done", amount: 200 },
  { rowId: "4", status: "", amount: null },
];

describe("toSummaryNumber", () => {
  it("coerces numerics and rejects non-numbers", () => {
    expect(toSummaryNumber(5)).toBe(5);
    expect(toSummaryNumber("12")).toBe(12);
    expect(toSummaryNumber(true)).toBe(1);
    expect(toSummaryNumber("abc")).toBeNull();
    expect(toSummaryNumber(null)).toBeNull();
    expect(toSummaryNumber("")).toBeNull();
  });
});

describe("numericColumns", () => {
  it("keeps only number columns", () => {
    const cols: ColumnDefinition[] = [
      { columnId: "a", name: "A", fieldType: "number", position: 0, required: false, editable: true },
      { columnId: "b", name: "B", fieldType: "text", position: 1, required: false, editable: true },
    ];
    expect(numericColumns(cols).map((c) => c.columnId)).toEqual(["a"]);
  });
});

describe("summarize", () => {
  it("counts rows per group (empty group labelled), sorted by count desc", () => {
    const s = summarize(rows, "status");
    expect(s.map((g) => [g.group, g.count])).toEqual([
      ["open", 2],
      ["(empty)", 1],
      ["done", 1],
    ]);
  });

  it("aggregates a numeric value column per group", () => {
    const s = summarize(rows, "status", "amount");
    const open = s.find((g) => g.group === "open")!;
    expect(open).toMatchObject({ count: 2, sum: 150, avg: 75, min: 50, max: 100 });
    const empty = s.find((g) => g.group === "(empty)")!;
    // row 4 has a null amount → counted as a row, but no numeric contribution
    expect(empty).toMatchObject({ count: 1, sum: 0, avg: 0, min: 0, max: 0 });
  });
});

describe("summaryChartBars", () => {
  it("uses count when no value column, scaled to the max bar", () => {
    const bars = summaryChartBars(summarize(rows, "status"), false);
    const open = bars.find((b) => b.group === "open")!;
    expect(open).toMatchObject({ value: 2, pct: 100 });
    const done = bars.find((b) => b.group === "done")!;
    expect(done).toMatchObject({ value: 1, pct: 50 });
  });

  it("uses sum when a value column is set", () => {
    const bars = summaryChartBars(summarize(rows, "status", "amount"), true);
    const done = bars.find((b) => b.group === "done")!; // sum 200 is the max
    expect(done).toMatchObject({ value: 200, pct: 100 });
    const open = bars.find((b) => b.group === "open")!; // sum 150
    expect(open.value).toBe(150);
    expect(open.pct).toBe(75);
  });
});
