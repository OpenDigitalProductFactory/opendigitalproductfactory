// Universal Grid & Workbooks — structured filter builder (EP-GRID-WORKBOOKS,
// toward Smartsheet/Airtable parity).
//
// The existing per-column filter (grid-filter.ts) is substring-only. This adds a
// real filter builder: typed operators per field (=, ≠, >, <, between, is empty,
// contains, starts/ends with, …) combined with AND / OR. Pure + unit-testable;
// the Grid owns the panel UI and persistence.

import { type CellValue, type ColumnDefinition, isNumericFieldType } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";
import { toNumber } from "./grid-field-format";

export type FilterOp =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "is_empty"
  | "is_not_empty";

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  contains: "contains",
  not_contains: "does not contain",
  equals: "is",
  not_equals: "is not",
  starts_with: "starts with",
  ends_with: "ends with",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  between: "between",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const TEXT_OPS: FilterOp[] = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
];
const NUMBER_OPS: FilterOp[] = [
  "equals",
  "not_equals",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_empty",
  "is_not_empty",
];
const DATE_OPS: FilterOp[] = ["equals", "not_equals", "gt", "lt", "between", "is_empty", "is_not_empty"];
const CHOICE_OPS: FilterOp[] = ["equals", "not_equals", "is_empty", "is_not_empty"];

/** Operators offered for a column, given its field type. */
export function opsForField(fieldType: ColumnDefinition["fieldType"]): FilterOp[] {
  if (isNumericFieldType(fieldType)) return NUMBER_OPS;
  if (fieldType === "date" || fieldType === "datetime") return DATE_OPS;
  if (fieldType === "select" || fieldType === "multi_select" || fieldType === "checkbox") return CHOICE_OPS;
  return TEXT_OPS;
}

/** Operators that need no value input (unary). */
export function isUnaryOp(op: FilterOp): boolean {
  return op === "is_empty" || op === "is_not_empty";
}

/** Operators that need a second value (range). */
export function isRangeOp(op: FilterOp): boolean {
  return op === "between";
}

export interface FilterCondition {
  id: string;
  columnId: string;
  op: FilterOp;
  value: string;
  /** Upper bound for `between`. */
  value2?: string;
}

export type FilterCombinator = "and" | "or";

export interface FilterGroup {
  combinator: FilterCombinator;
  conditions: FilterCondition[];
}

export const EMPTY_FILTER_GROUP: FilterGroup = { combinator: "and", conditions: [] };

function isBlank(v: CellValue): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

/** Evaluate one condition against a row's cell value. */
export function evaluateCondition(row: GridRowData, cond: FilterCondition): boolean {
  const raw = row[cond.columnId] ?? null;

  if (cond.op === "is_empty") return isBlank(raw);
  if (cond.op === "is_not_empty") return !isBlank(raw);

  const text = cellSearchText(raw).toLowerCase();
  const needle = cond.value.trim().toLowerCase();

  switch (cond.op) {
    case "contains":
      return text.includes(needle);
    case "not_contains":
      return !text.includes(needle);
    case "starts_with":
      return text.startsWith(needle);
    case "ends_with":
      return text.endsWith(needle);
    case "equals":
    case "not_equals": {
      // Numeric-aware equality when both sides are numbers, else text equality.
      const a = toNumber(raw);
      const b = toNumber(cond.value);
      const eq = a !== null && b !== null ? a === b : text === needle;
      return cond.op === "equals" ? eq : !eq;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(raw);
      const b = toNumber(cond.value);
      if (a === null || b === null) return false;
      if (cond.op === "gt") return a > b;
      if (cond.op === "gte") return a >= b;
      if (cond.op === "lt") return a < b;
      return a <= b;
    }
    case "between": {
      const a = toNumber(raw);
      const lo = toNumber(cond.value);
      const hi = toNumber(cond.value2 ?? "");
      if (a === null || lo === null || hi === null) return false;
      const min = Math.min(lo, hi);
      const max = Math.max(lo, hi);
      return a >= min && a <= max;
    }
    default:
      return true;
  }
}

/** A condition is "ready" once it has the value(s) its operator needs. */
export function conditionReady(cond: FilterCondition): boolean {
  if (isUnaryOp(cond.op)) return true;
  if (isRangeOp(cond.op)) return cond.value.trim() !== "" && (cond.value2 ?? "").trim() !== "";
  return cond.value.trim() !== "";
}

/**
 * Filter rows through a structured group. Only "ready" conditions apply (a
 * half-typed condition never hides rows). No ready conditions → all rows pass.
 */
export function applyFilterGroup(rows: GridRowData[], group: FilterGroup): GridRowData[] {
  const active = group.conditions.filter(conditionReady);
  if (active.length === 0) return rows;
  return rows.filter((row) => {
    const results = active.map((c) => evaluateCondition(row, c));
    return group.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
  });
}

/** Count of ready conditions (for the toolbar badge). */
export function activeConditionCount(group: FilterGroup): number {
  return group.conditions.filter(conditionReady).length;
}
