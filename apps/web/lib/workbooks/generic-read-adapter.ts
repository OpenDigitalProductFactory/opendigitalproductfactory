// Universal Grid & Workbooks — generic read-only adapter (EP-GRID-WORKBOOKS, Phase 2)
//
// "Every model is a grid": a config-driven DataSourceAdapter that exposes any
// Prisma model as a read-only grid/board without a bespoke adapter class. v1 is
// READ-ONLY by design and config-driven (an explicit field allow-list, not schema
// introspection) so it can never expose sensitive fields (passwordHash, tokens)
// and never performs a generic write. Models that need editing keep their
// bespoke, validated adapters (backlog/invoice/risk). Edit-capable generic
// adapters + DMMF introspection (with a steward denylist) are a later increment.

import { prisma } from "@dpf/db";
import {
  gridRegistry,
  type DataSourceAdapter,
  type AdapterContext,
} from "./adapter";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type FieldType,
  type SelectOption,
  type DataSourceFilter,
  type SortSpec,
  type Pagination,
  type PagedRows,
  type GridCapabilities,
} from "./types";
import { applyFilters, applySort, paginate } from "./grid-query";

export interface GenericColumn {
  /** Prisma scalar field name — also the grid columnId. Must be a real scalar field. */
  field: string;
  name: string;
  fieldType: FieldType;
  width?: number;
  options?: SelectOption[];
  groupable?: boolean;
}

export interface GenericTableConfig {
  entityType: string;
  /** Prisma delegate name, e.g. "epic", "digitalProduct". */
  prismaModel: string;
  /** A @unique scalar used as the grid rowId (e.g. "epicId"). */
  idField: string;
  columns: GenericColumn[];
  orderBy?: { field: string; dir: "asc" | "desc" };
  /** Hard cap on rows loaded (push-down pagination is a Phase-4 follow-up). */
  maxRows?: number;
}

const DEFAULT_CAP = 500;

/** Convert a Prisma scalar into the grid's CellValue based on the declared field type. */
export function toCell(fieldType: FieldType, v: unknown): CellValue {
  if (v === null || v === undefined) return fieldType === "multi_select" ? [] : null;
  switch (fieldType) {
    case "number":
      return typeof v === "number" ? v : Number((v as { toString(): string }).toString());
    case "date":
    case "datetime":
      return v instanceof Date ? v.toISOString() : String(v);
    case "checkbox":
      return Boolean(v);
    case "multi_select":
      return Array.isArray(v) ? (v as string[]) : [];
    default:
      return typeof v === "string" ? v : String(v);
  }
}

export function genericRowToGridRow(
  config: GenericTableConfig,
  row: Record<string, unknown>,
): GridRow {
  const cells: Record<string, CellValue> = {};
  for (const c of config.columns) cells[c.field] = toCell(c.fieldType, row[c.field]);
  return { rowId: String(row[config.idField]), cells };
}

export function genericColumnDefs(config: GenericTableConfig): ColumnDefinition[] {
  return config.columns.map((c, i) => ({
    columnId: c.field,
    name: c.name,
    fieldType: c.fieldType,
    position: i,
    required: false,
    editable: false, // generic v1 is read-only
    width: c.width,
    groupable: c.groupable ?? c.fieldType === "select",
    config: c.options ? { options: c.options } : undefined,
  }));
}

type ReadDelegate = {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
};

function delegate(model: string): ReadDelegate {
  const d = (prisma as unknown as Record<string, ReadDelegate>)[model];
  if (!d || typeof d.findMany !== "function") {
    throw new Error(`Unknown Prisma model for generic grid: ${model}`);
  }
  return d;
}

class GenericReadAdapter implements DataSourceAdapter {
  constructor(private readonly cfg: GenericTableConfig) {}

  get entityType(): string {
    return this.cfg.entityType;
  }

  private select(): Record<string, true> {
    const sel: Record<string, true> = { [this.cfg.idField]: true };
    for (const c of this.cfg.columns) sel[c.field] = true;
    return sel;
  }

  async getColumns(): Promise<ColumnDefinition[]> {
    return genericColumnDefs(this.cfg);
  }

  async queryRows(
    _entityType: string,
    opts: { filters: DataSourceFilter; sort: SortSpec[]; pagination: Pagination },
  ): Promise<PagedRows> {
    const cap = this.cfg.maxRows ?? DEFAULT_CAP;
    const records = await delegate(this.cfg.prismaModel).findMany({
      select: this.select(),
      ...(this.cfg.orderBy ? { orderBy: { [this.cfg.orderBy.field]: this.cfg.orderBy.dir } } : {}),
      take: cap,
    });
    if (records.length === cap) {
      // No silent caps: surface that older rows were omitted until SQL push-down lands.
      console.warn(
        `[workbooks] generic grid "${this.cfg.entityType}" hit the ${cap}-row cap; older rows omitted (push-down pagination is a Phase-4 follow-up).`,
      );
    }
    const rows = records.map((r) => genericRowToGridRow(this.cfg, r));
    const filtered = applyFilters(rows, opts.filters);
    const sorted = applySort(filtered, opts.sort);
    return paginate(sorted, opts.pagination.cursor, opts.pagination.limit);
  }

  async getRow(_entityType: string, rowId: string): Promise<GridRow | null> {
    const r = await delegate(this.cfg.prismaModel).findUnique({
      where: { [this.cfg.idField]: rowId },
      select: this.select(),
    });
    return r ? genericRowToGridRow(this.cfg, r) : null;
  }

  getCapabilities(_ctx: AdapterContext): GridCapabilities {
    return { canAddRow: false, canAddColumn: false, canEditCell: false, canDeleteRow: false };
  }
}

export function makeGenericReadAdapter(config: GenericTableConfig): DataSourceAdapter {
  return new GenericReadAdapter(config);
}

/** Build + register a generic read-only grid for a Prisma model. */
export function registerGenericReadTable(config: GenericTableConfig): void {
  gridRegistry.register(makeGenericReadAdapter(config));
}
