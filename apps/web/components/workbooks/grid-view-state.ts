// Universal Grid & Workbooks — persistent grid view state (EP-GRID-WORKBOOKS Phase 3)
//
// Serializes the per-grid view (quick filter, column filters, sort, conditional
// formatting, provenance toggle, summary config) so it survives reloads. Stored
// client-side per tableId — works for every grid (custom + platform) with no
// migration. Parsing is defensive: malformed/old payloads are ignored field by
// field, never throwing. Pure + unit-testable; the Grid owns the localStorage IO.

import type { ConditionalRule, CfOperator, CfColor } from "./grid-conditional-format";
import { CF_OPERATORS, CF_COLORS } from "./grid-conditional-format";
import { isRowHeight, type RowHeight } from "./grid-view-options";
import {
  FILTER_OP_LABELS,
  type FilterGroup,
  type FilterCondition,
  type FilterOp,
} from "./grid-filter-builder";

export interface SortState {
  columnKey: string;
  direction: "ASC" | "DESC";
}

export interface GridViewState {
  filterQuery: string;
  /** Structured filter (typed operators + AND/OR). */
  filterGroup: FilterGroup;
  /** @deprecated superseded by filterGroup; still parsed for old saved views. */
  columnFilters?: Record<string, string>;
  sort: SortState[];
  cfRules: ConditionalRule[];
  showProvenance: boolean;
  /** User-chosen column order (column ids); empty = natural order. */
  columnOrder: string[];
  /** Column ids the grid is grouped by (in-grid collapsible groups). */
  groupBy: string[];
  /** Column ids hidden from the grid/gallery/export. */
  hiddenColumns: string[];
  /** Number of leftmost visible columns pinned on horizontal scroll. */
  frozenCount: number;
  /** Row density preset. */
  rowHeight: RowHeight;
  /** Per-column footer aggregate (columnId → FooterAgg name). */
  footerAgg: Record<string, string>;
  /** Whether the per-column footer summary bar is shown. */
  showFooter: boolean;
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

/** Keep only the string entries of a would-be `string[]` (ids). */
function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
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

const FILTER_OPS = Object.keys(FILTER_OP_LABELS) as FilterOp[];

function parseFilterGroup(raw: unknown): FilterGroup | undefined {
  if (!isRecord(raw)) return undefined;
  const combinator = raw.combinator === "or" ? "or" : "and";
  if (!Array.isArray(raw.conditions)) return undefined;
  const conditions: FilterCondition[] = [];
  for (const c of raw.conditions) {
    if (
      isRecord(c) &&
      typeof c.id === "string" &&
      typeof c.columnId === "string" &&
      FILTER_OPS.includes(c.op as FilterOp) &&
      typeof c.value === "string"
    ) {
      conditions.push({
        id: c.id,
        columnId: c.columnId,
        op: c.op as FilterOp,
        value: c.value,
        ...(typeof c.value2 === "string" ? { value2: c.value2 } : {}),
      });
    }
  }
  return { combinator, conditions };
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
  const fg = parseFilterGroup(data.filterGroup);
  if (fg) out.filterGroup = fg;
  if (isRecord(data.columnFilters)) out.columnFilters = parseColumnFilters(data.columnFilters);
  if (Array.isArray(data.sort)) out.sort = parseSort(data.sort);
  if (Array.isArray(data.cfRules)) out.cfRules = parseCfRules(data.cfRules);
  if (typeof data.showProvenance === "boolean") out.showProvenance = data.showProvenance;
  if (Array.isArray(data.columnOrder)) out.columnOrder = parseStringArray(data.columnOrder);
  if (Array.isArray(data.groupBy)) out.groupBy = parseStringArray(data.groupBy);
  if (Array.isArray(data.hiddenColumns)) out.hiddenColumns = parseStringArray(data.hiddenColumns);
  if (typeof data.frozenCount === "number" && Number.isFinite(data.frozenCount)) {
    out.frozenCount = data.frozenCount;
  }
  if (isRowHeight(data.rowHeight)) out.rowHeight = data.rowHeight;
  if (isRecord(data.footerAgg)) out.footerAgg = parseColumnFilters(data.footerAgg);
  if (typeof data.showFooter === "boolean") out.showFooter = data.showFooter;
  return out;
}
