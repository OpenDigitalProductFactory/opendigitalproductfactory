import { describe, it, expect } from "vitest";
import {
  availableAggs,
  computeFooter,
  computeFooterRow,
  hasFooterAggs,
  toFooterAgg,
  FOOTER_AGG_LABELS,
} from "./grid-footer-summary";
import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";

const rows: GridRowData[] = [
  { rowId: "1", status: "open", amount: 100 },
  { rowId: "2", status: "open", amount: 50 },
  { rowId: "3", status: "done", amount: 200 },
  { rowId: "4", status: "", amount: null },
];

describe("availableAggs", () => {
  it("offers numeric aggregates only for number fields", () => {
    expect(availableAggs("number")).toContain("sum");
    expect(availableAggs("number")).toContain("avg");
    expect(availableAggs("text")).not.toContain("sum");
    expect(availableAggs("text")).toEqual(["none", "count", "filled", "empty", "unique"]);
  });
});

describe("computeFooter", () => {
  it("none returns empty string", () => {
    expect(computeFooter(rows, "amount", "none")).toBe("");
  });

  it("count is the total row count regardless of column", () => {
    expect(computeFooter(rows, "amount", "count")).toBe("4");
    expect(computeFooter(rows, "status", "count")).toBe("4");
  });

  it("filled / empty split on non-empty values", () => {
    expect(computeFooter(rows, "status", "filled")).toBe("3"); // "" is empty
    expect(computeFooter(rows, "status", "empty")).toBe("1");
    expect(computeFooter(rows, "amount", "filled")).toBe("3"); // null is empty
    expect(computeFooter(rows, "amount", "empty")).toBe("1");
  });

  it("unique counts distinct non-empty values", () => {
    expect(computeFooter(rows, "status", "unique")).toBe("2"); // open, done
  });

  it("numeric aggregates coerce and round", () => {
    expect(computeFooter(rows, "amount", "sum")).toBe("350");
    expect(computeFooter(rows, "amount", "avg")).toBe("116.67");
    expect(computeFooter(rows, "amount", "min")).toBe("50");
    expect(computeFooter(rows, "amount", "max")).toBe("200");
  });

  it("numeric aggregate with no numbers returns empty string", () => {
    expect(computeFooter(rows, "status", "sum")).toBe("");
  });
});

describe("computeFooterRow", () => {
  const columns: ColumnDefinition[] = [
    { columnId: "status", name: "Status", fieldType: "text", position: 0, required: false, editable: true },
    { columnId: "amount", name: "Amount", fieldType: "number", position: 1, required: false, editable: true },
  ];

  it("includes only columns with a non-none aggregate", () => {
    const out = computeFooterRow(rows, columns, { status: "count", amount: "none" });
    expect(out).toEqual({ status: "4" });
  });

  it("computes each configured column", () => {
    const out = computeFooterRow(rows, columns, { status: "unique", amount: "sum" });
    expect(out).toEqual({ status: "2", amount: "350" });
  });
});

describe("hasFooterAggs / toFooterAgg", () => {
  it("hasFooterAggs is true only when some column has a real aggregate", () => {
    expect(hasFooterAggs({})).toBe(false);
    expect(hasFooterAggs({ a: "none" })).toBe(false);
    expect(hasFooterAggs({ a: "none", b: "sum" })).toBe(true);
  });

  it("toFooterAgg coerces unknowns to none", () => {
    expect(toFooterAgg("sum")).toBe("sum");
    expect(toFooterAgg("bogus")).toBe("none");
    expect(toFooterAgg(42)).toBe("none");
  });

  it("every FooterAgg has a label", () => {
    expect(FOOTER_AGG_LABELS.sum).toBe("Sum");
    expect(FOOTER_AGG_LABELS.none).toBeTruthy();
  });
});
