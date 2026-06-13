// Universal Grid & Workbooks — shared types (EP-GRID-WORKBOOKS)
// Spec: docs/superpowers/specs/2026-03-23-universal-grid-workbooks-design.md
//
// These types are the library-agnostic contract between the data layer
// (adapters), the server (actions / API / MCP), and the presentation layer
// (the <Grid> component). The grid library (react-data-grid) is an
// implementation detail hidden behind the Grid component — nothing here
// references it, so it stays swappable.

/**
 * Field types. `formula`, `lookup`, and `rollup` are *computed* — read-only, never
 * user-written, derived on read. `image` stores an uploaded MediaAsset URL;
 * `attachment` stores an uploaded file's URL plus its display name/size (any file
 * type) — both content-addressed via /api/v1/upload. `rollup` aggregates the
 * records that reference this row (reverse-FK count/sum/avg/min/max; reporting
 * phase, platform grids first). `currency` remains out of scope.
 */
export const FIELD_TYPES = [
  "text",
  "number",
  "date",
  "datetime",
  "checkbox",
  "select",
  "multi_select",
  "reference",
  "url",
  "email",
  "image",
  "attachment",
  "formula",
  "lookup",
  "rollup",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Field types whose value is computed on read, not stored or user-edited. */
export const COMPUTED_FIELD_TYPES: readonly FieldType[] = ["formula", "lookup", "rollup"];

export function isComputedFieldType(fieldType: FieldType): boolean {
  return COMPUTED_FIELD_TYPES.includes(fieldType);
}

/** Option for select / multi_select columns, stored in WorkbookColumn.fieldConfig.options. */
export interface SelectOption {
  key: string;
  label: string;
  /** optional semantic intent so the grid can color the chip via report-kit statusColors */
  intent?: string;
}

/** Configuration for a `lookup` column: pull a field from a referenced record. */
export interface LookupConfig {
  /** columnId of a `reference` column on the same table */
  referenceColumnId: string;
  /** the field key on the referenced entity to surface */
  targetField: string;
  /** how to render the looked-up value (defaults to text) */
  targetFieldType?: FieldType;
}

/** Column-level configuration, persisted as WorkbookColumn.fieldConfig (JSON). */
export interface FieldConfig {
  /** select / multi_select options */
  options?: SelectOption[];
  /** reference target entity type (e.g. "epic", "customer_contact") */
  referenceType?: string;
  /** text fields: render as a multi-line textarea editor */
  multiline?: boolean;
  /** number fields: decimal places hint for display */
  precision?: number;
  /** formula columns: an Excel-style expression over other columns in the row */
  formula?: string;
  /** formula columns: how to render/coerce the computed result (defaults to text) */
  resultType?: FieldType;
  /** lookup columns: where to pull the value from */
  lookup?: LookupConfig;
}

/**
 * Where a column's values come from — the spec's three-tier provenance, shown as
 * a progressively-disclosed per-column label (official / live source / calculated
 * / your note). `system` = a governed platform field; `source` = a live external
 * feed (Phase 6); `derived` = computed (formula/lookup); `manual` = a free-form
 * user column.
 */
export const PROVENANCE_KINDS = ["system", "source", "derived", "manual"] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/** Human label for a provenance kind (end-user wording — no engineering jargon). */
export const PROVENANCE_LABELS: Record<ProvenanceKind, string> = {
  system: "Official",
  source: "Live source",
  derived: "Calculated",
  manual: "Your note",
};

/** A column as the grid consumes it — derived from a WorkbookColumn or an adapter's getColumns(). */
export interface ColumnDefinition {
  columnId: string;
  name: string;
  fieldType: FieldType;
  position: number;
  required: boolean;
  width?: number;
  config?: FieldConfig;
  /** false for adapter-declared read-only platform fields */
  editable: boolean;
  /** kanban group-by eligibility (select-like columns) */
  groupable?: boolean;
  /** value provenance, surfaced via progressive disclosure (defaults to "manual" if absent) */
  provenanceKind?: ProvenanceKind;
}

/** Derive provenance from field type for a custom (user-table) column. */
export function customColumnProvenance(fieldType: FieldType): ProvenanceKind {
  return isComputedFieldType(fieldType) ? "derived" : "manual";
}

/** A reference cell value carries both the id and a resolved display label. */
export interface ReferenceValue {
  referenceId: string;
  referenceType: string;
  label?: string;
}

/**
 * An attachment cell value: an uploaded file's retrieval URL plus display
 * metadata. The bytes live in content-addressed media storage (/api/v1/upload);
 * the cell only carries the URL and the original filename/size for display.
 */
export interface AttachmentValue {
  url: string;
  name?: string;
  size?: number;
}

/** The union of values a single cell can hold, keyed by field type at runtime. */
export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | ReferenceValue
  | AttachmentValue
  | null;

/** One row as the grid consumes it: a map of columnId -> value, plus the row id. */
export interface GridRow {
  rowId: string;
  cells: Record<string, CellValue>;
}

/** Capabilities the grid uses to enable/disable affordances. */
export interface GridCapabilities {
  canAddRow: boolean;
  canAddColumn: boolean;
  canEditCell: boolean;
  canDeleteRow: boolean;
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "in";

export interface FilterCondition {
  field: string; // columnId (custom) or sourceField (platform)
  operator: FilterOperator;
  value: string | number | boolean | string[];
}

/** Shared filter shape — used both for WorkbookTable.dataSourceFilter and ViewConfig.filters. */
export interface DataSourceFilter {
  conditions: FilterCondition[];
  logic: "and" | "or";
}

export interface SortSpec {
  columnId: string;
  direction: "asc" | "desc";
}

/** WorkbookView.config (JSON). */
export interface ViewConfig {
  columns: { columnId: string; visible: boolean; width?: number }[];
  sort: SortSpec[];
  filters: DataSourceFilter;
  kanban?: {
    groupByColumnId: string;
    cardFields: string[];
  };
}

/** Pagination contract, consistent with the platform's cursor-based helper. */
export interface Pagination {
  cursor?: string | null;
  limit: number;
}

export interface PagedRows {
  data: GridRow[];
  nextCursor: string | null;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const TEXT_MAX_LENGTH = 10_000;

/** The default empty view config applied to a freshly created table. */
export function emptyViewConfig(columns: ColumnDefinition[]): ViewConfig {
  return {
    columns: columns.map((c) => ({
      columnId: c.columnId,
      visible: true,
      width: c.width,
    })),
    sort: [],
    filters: { conditions: [], logic: "and" },
  };
}
