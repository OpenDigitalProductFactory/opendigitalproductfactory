// Universal Grid & Workbooks — persistent grid view state (EP-GRID-WORKBOOKS Phase 3)
//
// Serializes the per-grid view (quick filter, column filters, sort, conditional
// formatting, provenance toggle, summary config) so it survives reloads. Stored
// client-side per tableId — works for every grid (custom + platform) with no
// migration. Parsing is defensive: malformed/old payloads are ignored field by
// field, never throwing. Pure + unit-testable; the Grid owns the localStorage IO.

import type { ConditionalRule, CfOperator, CfColor } from "./grid-conditional-format";
import { CF_OPERATORS, CF_COLORS } from "./grid-conditional-format";

export interface SortState {
  columnKey: string;
  direction: "ASC" | "DESC";
}

export interface GridViewState {
  filterQuery: string;
  columnFilters: Record<string, string>;
  sort: SortState[];
  cfRules: ConditionalRule[];
  showProvenance: boolean;
}

export function viewStorageKey(tableId: string): string {
  return `dpf-workbook-view:${tableId}`;
}

export function serializeViewState(state: GridViewState): string {
  return JSON.stringify(state);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseSort(raw: unknown): SortState[] {
  if (!Array.isArray(raw)) return [];
  const out: SortState[] = [];
  for (const s of raw) {
    if (isRecord(s) && typeof s.columnKey === "string" && (s.direction === "ASC" || s.direction === "DESC")) {
      out.push({ columnKey: s.columnKey, direction: s.direction });
    }
  }
  return out;
}

function parseColumnFilters(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
}

function parseCfRules(raw: unknown): ConditionalRule[] {
  if (!Array.isArray(raw)) return [];
  const out: ConditionalRule[] = [];
  for (const r of raw) {
    if (
      isRecord(r) &&
      typeof r.id === "string" &&
      typeof r.columnId === "string" &&
      typeof r.value === "string" &&
      CF_OPERATORS.includes(r.operator as CfOperator) &&
      CF_COLORS.includes(r.color as CfColor)
    ) {
      out.push({
        id: r.id,
        columnId: r.columnId,
        operator: r.operator as CfOperator,
        value: r.value,
        color: r.color as CfColor,
      });
    }
  }
  return out;
}

/**
 * Defensively parse a stored view payload. Each field is validated independently;
 * anything malformed is dropped. Returns null only when the JSON itself is bad.
 */
export function parseViewState(raw: string | null | undefined): Partial<GridViewState> | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const out: Partial<GridViewState> = {};
  if (typeof data.filterQuery === "string") out.filterQuery = data.filterQuery;
  if (isRecord(data.columnFilters)) out.columnFilters = parseColumnFilters(data.columnFilters);
  if (Array.isArray(data.sort)) out.sort = parseSort(data.sort);
  if (Array.isArray(data.cfRules)) out.cfRules = parseCfRules(data.cfRules);
  if (typeof data.showProvenance === "boolean") out.showProvenance = data.showProvenance;
  return out;
}
