import { describe, it, expect } from "vitest";
import {
  ruleMatches,
  rowColor,
  rowColorClass,
  operatorNeedsValue,
  type ConditionalRule,
} from "./grid-conditional-format";
import type { GridRowData } from "./cell-editors";

const rule = (over: Partial<ConditionalRule>): ConditionalRule => ({
  id: "r",
  columnId: "status",
  operator: "eq",
  value: "",
  color: "amber",
  ...over,
});

const row: GridRowData = { rowId: "r1", status: "overdue", amount: 120, note: "" };

describe("ruleMatches", () => {
  it("eq / neq are case-insensitive on display text", () => {
    expect(ruleMatches(rule({ operator: "eq", value: "OVERDUE" }), row)).toBe(true);
    expect(ruleMatches(rule({ operator: "neq", value: "open" }), row)).toBe(true);
  });
  it("contains needs a non-empty needle", () => {
    expect(ruleMatches(rule({ operator: "contains", value: "due" }), row)).toBe(true);
    expect(ruleMatches(rule({ operator: "contains", value: "" }), row)).toBe(false);
  });
  it("empty / notEmpty test the raw value", () => {
    expect(ruleMatches(rule({ columnId: "note", operator: "empty" }), row)).toBe(true);
    expect(ruleMatches(rule({ columnId: "status", operator: "notEmpty" }), row)).toBe(true);
  });
  it("gt / lt coerce numerically and fail closed on non-numbers", () => {
    expect(ruleMatches(rule({ columnId: "amount", operator: "gt", value: "100" }), row)).toBe(true);
    expect(ruleMatches(rule({ columnId: "amount", operator: "lt", value: "100" }), row)).toBe(false);
    expect(ruleMatches(rule({ columnId: "status", operator: "gt", value: "1" }), row)).toBe(false);
  });
});

describe("rowColor", () => {
  it("returns the first matching rule's color", () => {
    const rules = [
      rule({ id: "a", columnId: "amount", operator: "lt", value: "100", color: "green" }),
      rule({ id: "b", columnId: "status", operator: "eq", value: "overdue", color: "red" }),
    ];
    expect(rowColor(row, rules)).toBe("red");
  });
  it("returns undefined when nothing matches", () => {
    expect(rowColor(row, [rule({ value: "paid" })])).toBeUndefined();
  });
});

describe("helpers", () => {
  it("rowColorClass maps to a css class", () => {
    expect(rowColorClass("blue")).toBe("dpf-cf-blue");
  });
  it("operatorNeedsValue is false only for empty/notEmpty", () => {
    expect(operatorNeedsValue("eq")).toBe(true);
    expect(operatorNeedsValue("empty")).toBe(false);
    expect(operatorNeedsValue("notEmpty")).toBe(false);
  });
});
