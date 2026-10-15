// Column rules (red stub).
import type { ColumnDefinition, FieldConfig, FieldType } from "./types";
export function columnRuleViolation(
  _input: { fieldType: FieldType; name?: string; config?: FieldConfig },
  _columns: readonly ColumnDefinition[],
  _referenceTargets: readonly string[],
): string | null {
  throw new Error("not implemented");
}
