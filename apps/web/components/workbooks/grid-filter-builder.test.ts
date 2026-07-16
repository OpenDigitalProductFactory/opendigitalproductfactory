import { describe, it, expect } from "vitest";
import {
  opsForField,
  isUnaryOp,
  isRangeOp,
  evaluateCondition,
  conditionReady,
  applyFilterGroup,
  activeConditionCount,
  type FilterCondition,
  type FilterGroup,
} from "./grid-filter-builder";
import type { GridRowData } from "./cell-editors";

const cond = (partial: Partial<FilterCondition>): FilterCondition => ({
  id: "c1",
  columnId: "x",
  op: "contains",
  value: "",
  ...partial,
});

describe("opsForField", () => {
  it("gives numeric operators to numeric-backed fields", () => {
    expect(opsForField("number")).toContain("between");
    expect(opsForField("currency")).toContain("gt");
    expect(opsForField("rating")).toContain("lte");
  });
  it("gives text operators to text fields", () => {
    expect(opsForField("text")).toContain("starts_with");
    expect(opsForField("text")).not.toContain("between");
  });
  it("gives choice operators to select/checkbox", () => {
    expect(opsForField("select")).toEqual(["equals", "not_equals", "is_empty", "is_not_empty"]);
    expect(opsForField("checkbox")).toContain("equals");
  });
  it("gives date operators to date fields", () => {
    expect(opsForField("date")).toContain("between");
    expect(opsForField("datetime")).toContain("lt");
  });
});

describe("op predicates", () => {
  it("flags unary and range ops", () => {
    expect(isUnaryOp("is_empty")).toBe(true);
    expect(isUnaryOp("contains")).toBe(false);
    expect(isRangeOp("between")).toBe(true);
    expect(isRangeOp("gt")).toBe(false);
  });
});

describe("evaluateCondition", () => {
  const row: GridRowData = { rowId: "1", name: "Widget", price: 42, note: "" };

  it("text contains / not_contains / starts / ends", () => {
    expect(evaluateCondition(row, cond({ columnId: "name", op: "contains", value: "idg" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "name", op: "not_contains", value: "xyz" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "name", op: "starts_with", value: "wid" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "name", op: "ends_with", value: "get" }))).toBe(true);
  });

  it("empty / not_empty", () => {
    expect(evaluateCondition(row, cond({ columnId: "note", op: "is_empty" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "name", op: "is_not_empty" }))).toBe(true);
  });

  it("numeric comparisons", () => {
    expect(evaluateCondition(row, cond({ columnId: "price", op: "gt", value: "40" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "price", op: "lt", value: "40" }))).toBe(false);
    expect(evaluateCondition(row, cond({ columnId: "price", op: "gte", value: "42" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "price", op: "between", value: "40", value2: "50" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "price", op: "between", value: "10", value2: "20" }))).toBe(false);
  });

  it("equals is numeric-aware then falls back to text", () => {
    expect(evaluateCondition(row, cond({ columnId: "price", op: "equals", value: "42" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "name", op: "equals", value: "widget" }))).toBe(true);
    expect(evaluateCondition(row, cond({ columnId: "name", op: "not_equals", value: "gadget" }))).toBe(true);
  });
});

describe("conditionReady", () => {
  it("unary ready always; value ops need a value; range needs both", () => {
    expect(conditionReady(cond({ op: "is_empty" }))).toBe(true);
    expect(conditionReady(cond({ op: "contains", value: "" }))).toBe(false);
    expect(conditionReady(cond({ op: "contains", value: "a" }))).toBe(true);
    expect(conditionReady(cond({ op: "between", value: "1", value2: "" }))).toBe(false);
    expect(conditionReady(cond({ op: "between", value: "1", value2: "2" }))).toBe(true);
  });
});

describe("applyFilterGroup", () => {
  const rows: GridRowData[] = [
    { rowId: "1", status: "open", amount: 100 },
    { rowId: "2", status: "open", amount: 50 },
    { rowId: "3", status: "done", amount: 200 },
  ];

  it("AND-combines ready conditions", () => {
    const group: FilterGroup = {
      combinator: "and",
      conditions: [
        cond({ id: "a", columnId: "status", op: "equals", value: "open" }),
        cond({ id: "b", columnId: "amount", op: "gt", value: "60" }),
      ],
    };
    expect(applyFilterGroup(rows, group).map((r) => r.rowId)).toEqual(["1"]);
  });

  it("OR-combines ready conditions", () => {
    const group: FilterGroup = {
      combinator: "or",
      conditions: [
        cond({ id: "a", columnId: "status", op: "equals", value: "done" }),
        cond({ id: "b", columnId: "amount", op: "lt", value: "60" }),
      ],
    };
    expect(applyFilterGroup(rows, group).map((r) => r.rowId)).toEqual(["2", "3"]);
  });

  it("ignores half-typed conditions and passes all when none ready", () => {
    const group: FilterGroup = {
      combinator: "and",
      conditions: [cond({ id: "a", columnId: "status", op: "contains", value: "" })],
    };
    expect(applyFilterGroup(rows, group)).toHaveLength(3);
    expect(activeConditionCount(group)).toBe(0);
  });
});
