// Universal Grid & Workbooks — derived-column computation (EP-GRID-WORKBOOKS, Phase 2)
//
// Computes `lookup` and `formula` cells for a set of grid rows, server-side, on
// read. Lookups pull an allow-listed field from a referenced platform record;
// formulas evaluate an Excel-style expression over the row's other columns (and
// earlier computed columns, in position order). Computed cells are never stored.

import {
  type CellValue,
  type FieldType,
  type FieldConfig,
  type GridRow,
  type ReferenceValue,
} from "../types";
import { fetchReferenceRecords, referenceKey } from "../reference-resolver";
import { evaluateFormula, normalizeName, type FormulaValue } from "./evaluate";

/** The minimal column shape compute needs (ColumnMeta and ColumnDefinition both satisfy it). */
export interface DerivableColumn {
  columnId: string;
  name: string;
  fieldType: FieldType;
  config?: FieldConfig | undefined;
}

function asReference(value: CellValue): ReferenceValue | null {
  if (value && typeof value === "object" && !Array.isArray(value) && "referenceId" in value) {
    return value as ReferenceValue;
  }
  return null;
}

/** Flatten a stored cell into a scalar a formula can operate on. */
function toFormulaValue(value: CellValue): FormulaValue {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(", ");
  const ref = asReference(value);
  if (ref) return ref.label ?? ref.referenceId;
  return value as FormulaValue;
}

/** Coerce a formula result to the column's declared result type for storage/display. */
function coerceResult(value: FormulaValue, resultType: FieldType | undefined): CellValue {
  if (value === null) return null;
  switch (resultType) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "checkbox":
      return typeof value === "boolean" ? value : Boolean(value);
    default:
      return typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : value;
  }
}

/**
 * Fill in `lookup` and `formula` cells on the given rows in place. `columns` must
 * be in position order. No-op when there are no computed columns.
 */
export async function computeDerivedCells(
  columns: DerivableColumn[],
  rows: GridRow[],
): Promise<void> {
  const lookupCols = columns.filter((c) => c.fieldType === "lookup" && c.config?.lookup);
  const formulaCols = columns.filter((c) => c.fieldType === "formula");
  if (lookupCols.length === 0 && formulaCols.length === 0) return;

  // A formula may resolve a reference inline via REF()/LOOKUP(); if any does, we
  // must fetch the records for every reference column too (not just lookup columns).
  const referenceCols = columns.filter((c) => c.fieldType === "reference");
  const formulaUsesRef =
    referenceCols.length > 0 &&
    formulaCols.some((fc) => /\b(ref|lookup)\s*\(/i.test(fc.config?.formula ?? ""));

  // 1) Batch-fetch every referenced record needed by lookup columns (+ all
  //    reference columns when a formula resolves references inline).
  const refsNeeded: { referenceType: string; referenceId: string }[] = [];
  for (const row of rows) {
    for (const lc of lookupCols) {
      const ref = asReference(row.cells[lc.config!.lookup!.referenceColumnId]);
      if (ref?.referenceId && ref.referenceType) {
        refsNeeded.push({ referenceType: ref.referenceType, referenceId: ref.referenceId });
      }
    }
    if (formulaUsesRef) {
      for (const rc of referenceCols) {
        const ref = asReference(row.cells[rc.columnId]);
        if (ref?.referenceId && ref.referenceType) {
          refsNeeded.push({ referenceType: ref.referenceType, referenceId: ref.referenceId });
        }
      }
    }
  }
  const records = refsNeeded.length > 0 ? await fetchReferenceRecords(refsNeeded) : new Map();

  // 2) Lookups: pull the target field from the referenced record (all rows first,
  //    so the column arrays built next include resolved lookup values).
  for (const row of rows) {
    for (const lc of lookupCols) {
      const { referenceColumnId, targetField } = lc.config!.lookup!;
      const ref = asReference(row.cells[referenceColumnId]);
      let value: CellValue = null;
      if (ref?.referenceId && ref.referenceType) {
        const rec = records.get(referenceKey(ref.referenceType, ref.referenceId));
        if (rec) value = rec.cells[targetField] ?? null;
      }
      row.cells[lc.columnId] = value;
    }
  }

  if (formulaCols.length === 0) return;

  // 3) Build the column dataset for cross-row functions (COUNTIF/SUMIF/AVERAGEIF):
  //    every non-formula column's values across all rows, in row order. Formula
  //    columns are intentionally excluded — aggregating over a derived column is a
  //    later slice — so a cross-row range over one yields "unknown column".
  const columnArrays = new Map<string, FormulaValue[]>();
  for (const c of columns) {
    if (c.fieldType === "formula") continue;
    columnArrays.set(
      normalizeName(c.name),
      rows.map((r) => toFormulaValue(r.cells[c.columnId] ?? null)),
    );
  }

  // Map a reference column's normalized name -> its columnId, for inline REF()/LOOKUP().
  const refColIdByName = new Map(referenceCols.map((c) => [normalizeName(c.name), c.columnId]));

  // 4) Formulas: evaluate in position order, each seeing earlier columns (per-row
  //    scope), the whole dataset (column arrays), and a per-row reference resolver.
  for (const row of rows) {
    const scope = new Map<string, FormulaValue>();
    for (const c of columns) {
      if (c.fieldType === "formula") continue;
      scope.set(normalizeName(c.name), toFormulaValue(row.cells[c.columnId] ?? null));
    }

    const resolveRef = formulaUsesRef
      ? (columnName: string, field?: string): FormulaValue => {
          const colId = refColIdByName.get(columnName);
          if (!colId) return null;
          const ref = asReference(row.cells[colId]);
          if (!ref?.referenceId || !ref.referenceType) return null;
          if (field === undefined) return ref.label ?? ref.referenceId; // REF → display
          const rec = records.get(referenceKey(ref.referenceType, ref.referenceId));
          return rec ? toFormulaValue(rec.cells[field] ?? null) : null; // LOOKUP → field
        }
      : undefined;

    for (const fc of formulaCols) {
      const res = evaluateFormula(fc.config?.formula ?? "", scope, columnArrays, resolveRef);
      row.cells[fc.columnId] = res.ok
        ? coerceResult(res.value, fc.config?.resultType)
        : `#ERROR: ${res.error ?? "formula"}`;
      scope.set(normalizeName(fc.name), res.ok ? res.value : null);
    }
  }
}
