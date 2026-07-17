import { describe, it, expect } from "vitest";
import { pivot, pivotAggNeedsValue, PIVOT_AGG_LABELS } from "./grid-pivot";
import type { GridRowData } from "./cell-editors";

// status × type, with an `amount` value column.
const rows: GridRowData[] = [
  { rowId: "1", status: "open", type: "bug", amount: 10 },
  { rowId: "2", status: "open", type: "bug", amount: 20 },
  { rowId: "3", status: "open", type: "feature", amount: 5 },
  { rowId: "4", status: "done", type: "bug", amount: 100 },
  { rowId: "5", status: "done", type: "feature", amount: 0 },
  { rowId: "6", status: "", type: "bug", amount: 7 }, // blank status → (empty)
];

describe("pivot — count", () => {
  const p = pivot(rows, "status", "type", undefined, "count");

  it("lists row keys with (empty) last, columns sorted", () => {
    expect(p.rowKeys).toEqual(["done", "open", "(empty)"]);
    expect(p.colKeys).toEqual(["bug", "feature"]);
  });

  it("counts rows per intersection", () => {
    expect(p.cells["open"]!["bug"]).toBe(2);
    expect(p.cells["open"]!["feature"]).toBe(1);
    expect(p.cells["done"]!["bug"]).toBe(1);
    expect(p.cells["(empty)"]!["feature"]).toBe(0); // no such row
  });

  it("computes row / column / grand totals", () => {
    expect(p.rowTotals["open"]).toBe(3);
    expect(p.colTotals["bug"]).toBe(4); // rows 1,2,4,6
    expect(p.grandTotal).toBe(6);
  });
});

describe("pivot — sum of a value column", () => {
  const p = pivot(rows, "status", "type", "amount", "sum");

  it("sums the value per intersection", () => {
    expect(p.cells["open"]!["bug"]).toBe(30); // 10 + 20
    expect(p.cells["done"]!["bug"]).toBe(100);
  });

  it("row/col/grand totals sum the raw values", () => {
    expect(p.rowTotals["open"]).toBe(35); // 10+20+5
    expect(p.colTotals["bug"]).toBe(137); // 10+20+100+7
    expect(p.grandTotal).toBe(142);
  });
});

describe("pivot — avg/min/max aggregate raw values, not cell aggregates", () => {
  it("avg total is the mean of the row's raw values (not a mean of cell means)", () => {
    const p = pivot(rows, "status", "type", "amount", "avg");
    // open row: values 10, 20, 5 → mean 11.67 (NOT (avg(bug)=15 + avg(feature)=5)/2 = 10)
    expect(p.rowTotals["open"]).toBe(11.67);
    expect(p.cells["open"]!["bug"]).toBe(15); // (10+20)/2
  });

  it("min/max over raw values", () => {
    const pMin = pivot(rows, "status", "type", "amount", "min");
    expect(pMin.rowTotals["open"]).toBe(5);
    const pMax = pivot(rows, "status", "type", "amount", "max");
    expect(pMax.colTotals["bug"]).toBe(100);
  });
});

describe("pivot — edge cases", () => {
  it("returns empty axes for no rows", () => {
    const p = pivot([], "status", "type", "amount", "sum");
    expect(p.rowKeys).toEqual([]);
    expect(p.colKeys).toEqual([]);
    expect(p.grandTotal).toBe(0);
  });

  it("non-numeric values are ignored by numeric aggregates (0 when none)", () => {
    const textRows: GridRowData[] = [{ rowId: "1", a: "x", b: "y", v: "not a number" }];
    const p = pivot(textRows, "a", "b", "v", "sum");
    expect(p.cells["x"]!["y"]).toBe(0);
  });
});

describe("pivotAggNeedsValue / labels", () => {
  it("count needs no value column; the rest do", () => {
    expect(pivotAggNeedsValue("count")).toBe(false);
    expect(pivotAggNeedsValue("sum")).toBe(true);
    expect(pivotAggNeedsValue("avg")).toBe(true);
  });

  it("labels every aggregate", () => {
    expect(PIVOT_AGG_LABELS.sum).toBe("Sum");
    expect(PIVOT_AGG_LABELS.count).toBe("Count");
  });
});
