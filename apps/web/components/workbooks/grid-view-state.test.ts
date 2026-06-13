import { describe, it, expect } from "vitest";
import {
  viewStorageKey,
  serializeViewState,
  parseViewState,
  type GridViewState,
} from "./grid-view-state";

const sample: GridViewState = {
  filterQuery: "open",
  columnFilters: { status: "active" },
  sort: [{ columnKey: "name", direction: "ASC" }],
  cfRules: [{ id: "r1", columnId: "status", operator: "eq", value: "overdue", color: "red" }],
  showProvenance: true,
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
});
