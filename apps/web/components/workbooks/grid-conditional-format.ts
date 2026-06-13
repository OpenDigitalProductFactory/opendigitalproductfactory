// Universal Grid & Workbooks — conditional formatting (EP-GRID-WORKBOOKS Phase 3)
//
// Pure rule evaluation for highlighting rows that match a condition (the Smartsheet
// "color rows where status = overdue" affordance). The first matching rule wins.
// Kept pure + unit-testable; the Grid owns the (session) rule list and applies the
// resulting class via react-data-grid's rowClass.

import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";

export const CF_OPERATORS = ["eq", "neq", "contains", "gt", "lt", "empty", "notEmpty"] as const;
export type CfOperator = (typeof CF_OPERATORS)[number];

export const CF_OPERATOR_LABELS: Record<CfOperator, string> = {
  eq: "equals",
  neq: "not equals",
  contains: "contains",
  gt: "greater than",
  lt: "less than",
  empty: "is empty",
  notEmpty: "is not empty",
};

export const CF_COLORS = ["red", "amber", "green", "blue"] as const;
export type CfColor = (typeof CF_COLORS)[number];

export interface ConditionalRule {
  id: string;
  columnId: string;
  operator: CfOperator;
  value: string;
  color: CfColor;
}

/** Does a single rule match a row? Numeric ops coerce; text ops are case-insensitive. */
export function ruleMatches(rule: ConditionalRule, row: GridRowData): boolean {
  const raw = cellSearchText(row[rule.columnId] ?? null);
  const text = raw.toLowerCase();
  const target = rule.value.trim().toLowerCase();
  switch (rule.operator) {
    case "eq":
      return text === target;
    case "neq":
      return text !== target;
    case "contains":
      return target.length > 0 && text.includes(target);
    case "empty":
      return raw === "";
    case "notEmpty":
      return raw !== "";
    case "gt":
    case "lt": {
      const n = Number(raw);
      const t = Number(rule.value);
      if (Number.isNaN(n) || Number.isNaN(t)) return false;
      return rule.operator === "gt" ? n > t : n < t;
    }
    default:
      return false;
  }
}

/** The color of the first matching rule for a row, or undefined. */
export function rowColor(row: GridRowData, rules: ConditionalRule[]): CfColor | undefined {
  for (const rule of rules) {
    if (ruleMatches(rule, row)) return rule.color;
  }
  return undefined;
}

/** The CSS class that paints a row a given conditional-format color. */
export function rowColorClass(color: CfColor): string {
  return `dpf-cf-${color}`;
}

/** Operators that don't need a value input. */
export function operatorNeedsValue(op: CfOperator): boolean {
  return op !== "empty" && op !== "notEmpty";
}

/** A blank rule seeded to the first column (for the rule builder). */
export function blankRule(id: string, columns: ColumnDefinition[]): ConditionalRule {
  return {
    id,
    columnId: columns[0]?.columnId ?? "",
    operator: "eq",
    value: "",
    color: "amber",
  };
}
