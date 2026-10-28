// Universal Grid & Workbooks — column rules against the table (BI-FE8DF004).
//
// addColumnSchema (./column-schema) checks a column create on its own: the type is
// known and computed columns carry a definition. These rules check it against the
// TABLE it joins and the caller's reach, which the schema cannot see:
//   - select / multi_select carry at least one option (a kanban lane per option);
//   - a reference or link target is one the caller may reference
//     (platform-tables listReferenceTargets, capability-filtered per person);
//   - a formula only names columns of this table and known functions;
//   - a lookup reads through a reference column, and a rollup counts a link
//     column, on this same table;
//   - column names are unique on the table (formulas resolve columns by name).
// Pure, so it is unit-tested without Prisma; workbook-authoring applies it.

import { checkFormula } from "./formula/check";
import { normalizeName } from "./formula/evaluate";
import type { ColumnDefinition, FieldConfig, FieldType } from "./types";

export interface ColumnRuleInput {
  fieldType: FieldType;
  name?: string;
  config?: FieldConfig;
}

function targetProblem(referenceType: string | undefined, targets: readonly string[]): string | null {
  if (!referenceType) return "A link target is required for this column";
  if (!targets.includes(referenceType)) {
    return `This column cannot link to ${referenceType}. Available targets: ${targets.join(", ") || "none"}`;
  }
  return null;
}

function sameTableColumn(
  columns: readonly ColumnDefinition[],
  columnId: string | undefined,
  fieldType: FieldType,
): boolean {
  return columns.some((c) => c.columnId === columnId && c.fieldType === fieldType);
}

/** Return why this column cannot join the table, or null when it can. */
export function columnRuleViolation(
  input: ColumnRuleInput,
  columns: readonly ColumnDefinition[],
  referenceTargets: readonly string[],
): string | null {
  const { fieldType, config } = input;

  if (input.name !== undefined) {
    const key = normalizeName(input.name);
    const clash = columns.find((c) => normalizeName(c.name) === key);
    if (clash) return `This table already has a column named "${clash.name}"`;
  }

  switch (fieldType) {
    case "select":
    case "multi_select":
      return config?.options && config.options.length > 0
        ? null
        : "A select column needs at least one option";
    case "reference":
      return targetProblem(config?.referenceType, referenceTargets);
    case "link":
      return targetProblem(config?.link?.referenceType, referenceTargets);
    case "formula":
      return checkFormula(config?.formula ?? "", columns.map((c) => c.name));
    case "lookup":
      return sameTableColumn(columns, config?.lookup?.referenceColumnId, "reference")
        ? null
        : "A lookup column must read through a reference column on this table";
    case "rollup":
      return sameTableColumn(columns, config?.rollup?.linkColumnId, "link")
        ? null
        : "A rollup column must count a link column on this table";
    default:
      return null;
  }
}
