import { describe, it, expect } from "vitest";
import { applyFilters, applySort, paginate } from "./grid-query";
import type { GridRow } from "./types";

const rows: GridRow[] = [
  { rowId: "ROW-1", cells: { name: "Charlie", age: 30, active: true } },
  { rowId: "ROW-2", cells: { name: "alice", age: 25, active: false } },
  { rowId: "ROW-3", cells: { name: "Bob", age: 40, active: true } },
];

describe("applyFilters", () => {
  it("returns all rows when no conditions", () => {
    expect(applyFilters(rows, { conditions: [], logic: "and" })).toHaveLength(3);
  });

  it("filters with eq", () => {
    const r = applyFilters(rows, { conditions: [{ field: "active", operator: "eq", value: true }], logic: "and" });
    expect(r.map((x) => x.rowId)).toEqual(["ROW-1", "ROW-3"]);
  });

  it("filters with gt on numbers", () => {
    const r = applyFilters(rows, { conditions: [{ field: "age", operator: "gt", value: 28 }], logic: "and" });
    expect(r.map((x) => x.rowId).sort()).toEqual(["ROW-1", "ROW-3"]);
  });

  it("contains is case-insensitive", () => {
    const r = applyFilters(rows, { conditions: [{ field: "name", operator: "contains", value: "li" }], logic: "and" });
    // "Charlie" and "alice" both contain "li"
    expect(r.map((x) => x.rowId).sort()).toEqual(["ROW-1", "ROW-2"]);
  });

  it("combines with or logic", () => {
    const r = applyFilters(rows, {
      conditions: [
        { field: "age", operator: "lt", value: 26 },
        { field: "age", operator: "gt", value: 39 },
      ],
      logic: "or",
    });
    expect(r.map((x) => x.rowId).sort()).toEqual(["ROW-2", "ROW-3"]);
  });
});

describe("applySort", () => {
  it("sorts ascending by number", () => {
    const r = applySort(rows, [{ columnId: "age", direction: "asc" }]);
    expect(r.map((x) => x.cells.age)).toEqual([25, 30, 40]);
  });

  it("sorts descending by string (codepoint order)", () => {
    // Raw codepoint comparison: uppercase letters sort before lowercase.
    // Ascending: ["Bob", "Charlie", "alice"]; descending reverses it.
    const r = applySort(rows, [{ columnId: "name", direction: "desc" }]);
    expect(r.map((x) => x.cells.name)).toEqual(["alice", "Charlie", "Bob"]);
  });

  it("does not mutate the input array", () => {
    const before = rows.map((r) => r.rowId);
    applySort(rows, [{ columnId: "age", direction: "desc" }]);
    expect(rows.map((r) => r.rowId)).toEqual(before);
  });
});

describe("paginate", () => {
  it("returns a page and a next cursor", () => {
    const { data, nextCursor } = paginate(rows, null, 2);
    expect(data.map((r) => r.rowId)).toEqual(["ROW-1", "ROW-2"]);
    expect(nextCursor).toBe("ROW-2");
  });

  it("continues from a cursor and ends with null cursor", () => {
    const { data, nextCursor } = paginate(rows, "ROW-2", 2);
    expect(data.map((r) => r.rowId)).toEqual(["ROW-3"]);
    expect(nextCursor).toBeNull();
  });
});
