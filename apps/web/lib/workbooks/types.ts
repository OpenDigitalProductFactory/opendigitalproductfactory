// Universal Grid & Workbooks — shared types (EP-GRID-WORKBOOKS)
// Spec: docs/superpowers/specs/2026-03-23-universal-grid-workbooks-design.md
//
// These types are the library-agnostic contract between the data layer
// (adapters), the server (actions / API / MCP), and the presentation layer
// (the <Grid> component). The grid library (react-data-grid) is an
// implementation detail hidden behind the Grid component — nothing here
// references it, so it stays swappable.

/** Phase-1 field types. Phase-2 (formula, rollup, lookup, attachment, currency) are out of scope. */
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
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Option for select / multi_select columns, stored in WorkbookColumn.fieldConfig.options. */
export interface SelectOption {
  key: string;
  label: string;
  /** optional semantic intent so the grid can color the chip via report-kit statusColors */
  intent?: string;
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
}

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
}

/** A reference cell value carries both the id and a resolved display label. */
export interface ReferenceValue {
  referenceId: string;
  referenceType: string;
  label?: string;
}

/** The union of values a single cell can hold, keyed by field type at runtime. */
export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | ReferenceValue
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
