import { describe, it, expect } from "vitest";
import { columnRuleViolation } from "./column-rules";
import type { ColumnDefinition, FieldType } from "./types";

function col(columnId: string, name: string, fieldType: FieldType, config?: ColumnDefinition["config"]): ColumnDefinition {
  return { columnId, name, fieldType, position: 0, required: false, editable: true, config };
}

const TABLE: ColumnDefinition[] = [
  col("COL-title", "Title", "text"),
  col("COL-hours", "Hours", "number"),
  col("COL-owner", "Owner", "reference", { referenceType: "employee" }),
  col("COL-epics", "Epics", "link", { link: { cardinality: "many", referenceType: "epic" } }),
];
const TARGETS = ["epic", "employee", "backlog_item"];

describe("columnRuleViolation — a typed column must make sense on its table", () => {
  it("accepts plain typed columns", () => {
    expect(columnRuleViolation({ fieldType: "text" }, TABLE, TARGETS)).toBeNull();
    expect(
      columnRuleViolation(
        { fieldType: "select", config: { options: [{ key: "todo", label: "To do" }] } },
        TABLE,
        TARGETS,
      ),
    ).toBeNull();
  });

  it("requires options on a select column", () => {
    expect(columnRuleViolation({ fieldType: "select" }, TABLE, TARGETS)).toMatch(/option/i);
    expect(columnRuleViolation({ fieldType: "multi_select", config: { options: [] } }, TABLE, TARGETS)).toMatch(/option/i);
  });

  it("accepts a link to a target the caller may reference and refuses any other", () => {
    expect(
      columnRuleViolation({ fieldType: "link", config: { link: { cardinality: "one", referenceType: "epic" } } }, TABLE, TARGETS),
    ).toBeNull();
    expect(
      columnRuleViolation({ fieldType: "link", config: { link: { cardinality: "many", referenceType: "payroll_run" } } }, TABLE, TARGETS),
    ).toMatch(/cannot link to payroll_run/i);
    expect(columnRuleViolation({ fieldType: "link" }, TABLE, TARGETS)).toMatch(/link target/i);
  });

  it("refuses a reference column whose target the caller may not reference", () => {
    expect(columnRuleViolation({ fieldType: "reference", config: { referenceType: "secret_thing" } }, TABLE, TARGETS)).toMatch(
      /cannot link to secret_thing/i,
    );
  });

  it("checks a formula against the table's columns", () => {
    expect(columnRuleViolation({ fieldType: "formula", config: { formula: "Hours * 2", resultType: "number" } }, TABLE, TARGETS)).toBeNull();
    expect(columnRuleViolation({ fieldType: "formula", config: { formula: "Budget * 2" } }, TABLE, TARGETS)).toMatch(/Budget/);
  });

  it("requires a lookup to read through a reference column on the same table", () => {
    expect(
      columnRuleViolation({ fieldType: "lookup", config: { lookup: { referenceColumnId: "COL-owner", targetField: "email" } } }, TABLE, TARGETS),
    ).toBeNull();
    expect(
      columnRuleViolation({ fieldType: "lookup", config: { lookup: { referenceColumnId: "COL-hours", targetField: "email" } } }, TABLE, TARGETS),
    ).toMatch(/reference column on this table/i);
  });

  it("requires a rollup to count a link column on the same table", () => {
    expect(columnRuleViolation({ fieldType: "rollup", config: { rollup: { linkColumnId: "COL-epics", op: "count" } } }, TABLE, TARGETS)).toBeNull();
    expect(columnRuleViolation({ fieldType: "rollup", config: { rollup: { linkColumnId: "COL-title", op: "count" } } }, TABLE, TARGETS)).toMatch(
      /link column on this table/i,
    );
    expect(columnRuleViolation({ fieldType: "rollup" }, TABLE, TARGETS)).toMatch(/link column/i);
  });

  it("refuses a duplicate column name on the table", () => {
    expect(columnRuleViolation({ fieldType: "text", name: " title " }, TABLE, TARGETS)).toMatch(/already has a column named/i);
  });
});
