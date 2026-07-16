import { describe, it, expect } from "vitest";
import {
  viewStorageKey,
  serializeViewState,
  parseViewState,
  type GridViewState,
} from "./grid-view-state";

const sample: GridViewState = {
  filterQuery: "open",
  filterGroup: {
    combinator: "and",
    conditions: [{ id: "f1", columnId: "status", op: "equals", value: "open" }],
  },
  sort: [{ columnKey: "name", direction: "ASC" }],
  cfRules: [{ id: "r1", columnId: "status", operator: "eq", value: "overdue", color: "red" }],
  showProvenance: true,
  columnOrder: ["name", "status", "amount"],
  groupBy: ["status"],
  hiddenColumns: ["amount"],
  frozenCount: 2,
  rowHeight: "tall",
  footerAgg: { amount: "sum" },
  showFooter: true,
};

describe("viewStorageKey", () => {
  it("namespaces by tableId", () => {
    expect(viewStorageKey("TBL-1")).toBe("dpf-workbook-view:TBL-1");
  });
});

describe("serialize/parse round-trip", () => {
  it("preserves a valid view state", () => {
    expect(parseViewState(serializeViewState(sample))).toEqual(sample);
  });
});

describe("parseViewState — defensive", () => {
  it("returns null for empty or malformed JSON", () => {
    expect(parseViewState(null)).toBeNull();
    expect(parseViewState("")).toBeNull();
    expect(parseViewState("{not json")).toBeNull();
    expect(parseViewState("[]")).toBeNull(); // not an object
  });

  it("drops fields with the wrong type instead of throwing", () => {
    const parsed = parseViewState(
      JSON.stringify({ filterQuery: 5, columnFilters: { a: 1, b: "x" }, sort: "nope", showProvenance: "yes" }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.filterQuery).toBeUndefined(); // 5 is not a string
    expect(parsed!.columnFilters).toEqual({ b: "x" }); // a:1 dropped
    expect(parsed!.sort).toBeUndefined(); // "nope" is not an array
    expect(parsed!.showProvenance).toBeUndefined(); // "yes" is not boolean
  });

  it("filters invalid conditional-format rules", () => {
    const parsed = parseViewState(
      JSON.stringify({
        cfRules: [
          { id: "ok", columnId: "c", operator: "eq", value: "v", color: "red" },
          { id: "bad-op", columnId: "c", operator: "bogus", value: "v", color: "red" },
          { id: "bad-color", columnId: "c", operator: "eq", value: "v", color: "purple" },
        ],
      }),
    );
    expect(parsed!.cfRules).toHaveLength(1);
    expect(parsed!.cfRules![0].id).toBe("ok");
  });

  it("keeps only valid sort entries", () => {
    const parsed = parseViewState(
      JSON.stringify({ sort: [{ columnKey: "a", direction: "ASC" }, { columnKey: "b", direction: "sideways" }, {}] }),
    );
    expect(parsed!.sort).toEqual([{ columnKey: "a", direction: "ASC" }]);
  });

  it("keeps only string ids in columnOrder and groupBy", () => {
    const parsed = parseViewState(
      JSON.stringify({ columnOrder: ["a", 2, "b", null], groupBy: ["status", 7] }),
    );
    expect(parsed!.columnOrder).toEqual(["a", "b"]);
    expect(parsed!.groupBy).toEqual(["status"]);
  });

  it("ignores columnOrder / groupBy that are not arrays", () => {
    const parsed = parseViewState(JSON.stringify({ columnOrder: "a,b", groupBy: {} }));
    expect(parsed!.columnOrder).toBeUndefined();
    expect(parsed!.groupBy).toBeUndefined();
  });

  it("parses a filterGroup, dropping malformed conditions", () => {
    const parsed = parseViewState(
      JSON.stringify({
        filterGroup: {
          combinator: "or",
          conditions: [
            { id: "a", columnId: "amount", op: "gt", value: "10" },
            { id: "b", columnId: "x", op: "bogus_op", value: "y" },
            { id: "c", columnId: "name", op: "between", value: "1", value2: "9" },
          ],
        },
      }),
    );
    expect(parsed!.filterGroup!.combinator).toBe("or");
    expect(parsed!.filterGroup!.conditions.map((c) => c.id)).toEqual(["a", "c"]);
    expect(parsed!.filterGroup!.conditions[1]!.value2).toBe("9");
  });

  it("parses hiddenColumns, a finite frozenCount, and a valid rowHeight", () => {
    const parsed = parseViewState(
      JSON.stringify({ hiddenColumns: ["a", 1, "b"], frozenCount: 2, rowHeight: "short" }),
    );
    expect(parsed!.hiddenColumns).toEqual(["a", "b"]);
    expect(parsed!.frozenCount).toBe(2);
    expect(parsed!.rowHeight).toBe("short");
  });

  it("drops a non-finite frozenCount and an invalid rowHeight", () => {
    const parsed = parseViewState(
      JSON.stringify({ frozenCount: "two", rowHeight: "gigantic" }),
    );
    expect(parsed!.frozenCount).toBeUndefined();
    expect(parsed!.rowHeight).toBeUndefined();
  });

  it("parses footerAgg as a string record, dropping non-string values", () => {
    const parsed = parseViewState(
      JSON.stringify({ footerAgg: { amount: "sum", bad: 3, status: "count" } }),
    );
    expect(parsed!.footerAgg).toEqual({ amount: "sum", status: "count" });
  });
});
