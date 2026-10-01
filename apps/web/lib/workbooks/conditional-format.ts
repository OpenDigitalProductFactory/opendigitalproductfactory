// Universal Grid & Workbooks — conditional-format vocabulary (EP-GRID-WORKBOOKS Phase 3)
//
// The closed operator and color sets and the rule shape. The grid evaluates
// rules (components/workbooks/grid-conditional-format.ts) and the office export
// writes them (lib/workbooks/export-*.ts); both read this one vocabulary, and
// it lives in lib so lib code never imports components/** (M11 lib/ui layering).

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
