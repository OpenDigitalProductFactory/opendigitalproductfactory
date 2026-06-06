// Universal Grid & Workbooks — in-memory filter/sort over GridRow[] (EP-GRID-WORKBOOKS)
//
// Pure functions shared by the custom-table adapter and tests. Custom tables
// store cells EAV-style, so Phase-1 filtering/sorting runs in memory over a
// table's materialized rows. Large-table push-down to SQL is a follow-up.

import {
  type GridRow,
  type CellValue,
  type DataSourceFilter,
  type FilterCondition,
  type SortSpec,
  type ReferenceValue,
} from "./types";

function comparable(value: CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "object") return (value as ReferenceValue).referenceId ?? null;
  return value;
}

/** Order two scalars: numerically when both are numeric, else by string. */
function order(a: string | number | boolean, b: FilterCondition["value"]): number {
  if (typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  const as = String(a);
  const bs = String(b);
  return as === bs ? 0 : as < bs ? -1 : 1;
}

function matchesCondition(row: GridRow, cond: FilterCondition): boolean {
  const raw = row.cells[cond.field] ?? null;
  const left = comparable(raw);
  const right = cond.value;

  switch (cond.operator) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return left !== null && order(left, right) > 0;
    case "gte":
      return left !== null && order(left, right) >= 0;
    case "lt":
      return left !== null && order(left, right) < 0;
    case "lte":
      return left !== null && order(left, right) <= 0;
    case "contains":
      return (
        left !== null &&
        String(left).toLowerCase().includes(String(right).toLowerCase())
      );
    case "in":
      return Array.isArray(right) && right.map(String).includes(String(left));
    default:
      return true;
  }
}

export function applyFilters(rows: GridRow[], filter?: DataSourceFilter): GridRow[] {
  if (!filter || filter.conditions.length === 0) return rows;
  const logic = filter.logic ?? "and";
  return rows.filter((row) => {
    const results = filter.conditions.map((c) => matchesCondition(row, c));
    return logic === "or" ? results.some(Boolean) : results.every(Boolean);
  });
}

export function applySort(rows: GridRow[], sort: SortSpec[]): GridRow[] {
  if (!sort || sort.length === 0) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const spec of sort) {
      const av = comparable(a.cells[spec.columnId] ?? null);
      const bv = comparable(b.cells[spec.columnId] ?? null);
      if (av === bv) continue;
      // nulls sort last regardless of direction
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = av < bv ? -1 : 1;
      return spec.direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

/** Cursor pagination over an ordered GridRow[] using rowId as the cursor. */
export function paginate(
  rows: GridRow[],
  cursor: string | null | undefined,
  limit: number,
): { data: GridRow[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const idx = rows.findIndex((r) => r.rowId === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const page = rows.slice(start, start + limit);
  const nextCursor =
    start + limit < rows.length && page.length > 0
      ? page[page.length - 1].rowId
      : null;
  return { data: page, nextCursor };
}
