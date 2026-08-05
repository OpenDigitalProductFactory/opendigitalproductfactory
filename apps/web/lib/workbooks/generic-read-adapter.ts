// Universal Grid & Workbooks — generic adapter (EP-GRID-WORKBOOKS, Phase 2/3)
//
// "Every model is a grid": a config-driven DataSourceAdapter that exposes any
// Prisma model as a grid/board without a bespoke adapter class. Config-driven via
// an explicit field allow-list (not schema introspection) so it can never expose
// sensitive fields (passwordHash, tokens).
//
// READ is the default. WRITE is opt-in per config via `editableFields` — the
// "validated raw-write tier" (operator-approved 2026-06-12): for models without a
// bespoke domain action, the generic adapter writes via Prisma, but only to
// allow-listed fields and only after the SAME `validateCell` the rest of the
// platform uses (so a write is still typed + validated, just not routed through a
// hand-written domain action). Models that have real domain logic keep their
// bespoke validated adapters (backlog/invoice/risk).

import { prisma } from "@dpf/db";
import {
  gridRegistry,
  type DataSourceAdapter,
  type AdapterContext,
  type ReferenceResolution,
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
import { validateCell, type CellStorage } from "./cell-validation";
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
  /**
   * Scalar field shown as the human label when this model is the target of a
   * reference column (Phase 2). Defaults to the first text column after the id
   * field, falling back to the id field itself.
   */
  labelField?: string;
  /**
   * Opt-in writable fields (validated raw-write tier). A subset of `columns`
   * field names; the id field and any non-listed field stay read-only. Omit for a
   * read-only grid. Each write goes through `validateCell` before Prisma.
   */
  editableFields?: string[];
  /**
   * Read-only `rollup` columns: aggregate the records of another model that
   * reference this row (reporting phase, reverse-FK). Resolved with one grouped
   * query per rollup, then assigned per row — no N+1.
   */
  rollups?: RollupSpec[];
  /**
   * Optional governed write path. When set, a validated edit is handed to this
   * function INSTEAD of being written straight to Prisma — so a model that owns a
   * governed domain action (audit log, capability check, lifecycle rules) keeps
   * those guarantees for grid edits too. The raw-write tier stays the default for
   * models with no domain action of their own (e.g. supplier).
   *
   * Receives the grid rowId and the already-validated Prisma scalars. Must throw
   * or return a failure result to reject the edit.
   */
  writeThrough?: (
    rowId: string,
    data: Record<string, unknown>,
  ) => Promise<{ ok: boolean; message: string }>;
}

/**
 * A rollup column: aggregate a related model's rows that point back at this row
 * via a foreign key. e.g. on an Epic grid, count BacklogItems where epicId = this
 * epic — note the FK targets the cuid PK (`anchorField: "id"`), NOT the semantic
 * id used as the grid rowId, so the join uses `anchorField`, not `idField`.
 */
export interface RollupSpec {
  /** grid columnId for this rollup column */
  field: string;
  name: string;
  /** Prisma delegate of the model to aggregate (the "many" side), e.g. "backlogItem" */
  targetModel: string;
  /** the FK scalar on the target model pointing back to this model, e.g. "epicId" */
  foreignKeyField: string;
  /** field on THIS model the FK references; defaults to the grid idField. For FKs that target a cuid PK, set "id". */
  anchorField?: string;
  /** aggregation operation */
  op: "count" | "sum" | "avg" | "min" | "max";
  /** numeric field on the target model to aggregate (required for sum/avg/min/max; ignored for count) */
  valueField?: string;
  width?: number;
  /** optional extra Prisma `where` to scope which target rows are counted (e.g. exclude archived) */
  filter?: Record<string, unknown>;
}

const DEFAULT_CAP = 500;
const REFERENCE_SEARCH_LIMIT = 20;

/** The field used as the reference display label — explicit, else first non-id text column, else the id. */
export function referenceLabelField(config: GenericTableConfig): string {
  if (config.labelField) return config.labelField;
  const firstText = config.columns.find(
    (c) => c.fieldType === "text" && c.field !== config.idField,
  );
  return firstText?.field ?? config.idField;
}

/** Pure builder for the reference-typeahead findMany args (testable without Prisma). */
export function buildReferenceSearchArgs(config: GenericTableConfig, query: string) {
  const labelField = referenceLabelField(config);
  const trimmed = query.trim();
  return {
    where: trimmed ? { [labelField]: { contains: trimmed, mode: "insensitive" } } : {},
    select: { [config.idField]: true, [labelField]: true },
    orderBy: { [labelField]: "asc" as const },
    take: REFERENCE_SEARCH_LIMIT,
  };
}

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

/** Runs a Prisma `groupBy` for the named model — injected so the resolver is unit-testable without a DB. */
export type GroupByRunner = (model: string, args: unknown) => Promise<Record<string, unknown>[]>;

/**
 * Resolve every rollup column to a Map<anchorValue, aggregate> using one grouped
 * query per rollup (no N+1). Pure but for the injected runner, so it is testable
 * with a stub. Anchor values are de-duplicated and only the rows actually present
 * are queried, so the aggregate is correct for the loaded page.
 */
export async function resolveRollups(
  config: GenericTableConfig,
  records: Record<string, unknown>[],
  runGroupBy: GroupByRunner,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  for (const spec of config.rollups ?? []) {
    const anchorField = spec.anchorField ?? config.idField;
    const anchors = [...new Set(records.map((r) => r[anchorField]).filter((v) => v != null))];
    const valueMap = new Map<string, number>();
    if (anchors.length > 0) {
      if (spec.op !== "count" && !spec.valueField) {
        throw new Error(`Rollup "${spec.field}" with op "${spec.op}" requires a valueField`);
      }
      const aggregate =
        spec.op === "count"
          ? { _count: { _all: true } }
          : { [`_${spec.op}`]: { [spec.valueField as string]: true } };
      const groups = await runGroupBy(spec.targetModel, {
        by: [spec.foreignKeyField],
        where: { [spec.foreignKeyField]: { in: anchors }, ...(spec.filter ?? {}) },
        ...aggregate,
      });
      for (const g of groups) {
        const key = String(g[spec.foreignKeyField]);
        const value =
          spec.op === "count"
            ? Number((g._count as { _all?: number } | undefined)?._all ?? 0)
            : Number(
                (g[`_${spec.op}`] as Record<string, unknown> | undefined)?.[spec.valueField as string] ?? 0,
              );
        valueMap.set(key, value);
      }
    }
    out.set(spec.field, valueMap);
  }
  return out;
}

/** Build grid rows from raw records, attaching resolved rollup values (count → 0, others → null when absent). */
function buildGridRows(
  config: GenericTableConfig,
  records: Record<string, unknown>[],
  rollupMaps: Map<string, Map<string, number>>,
): GridRow[] {
  return records.map((r) => {
    const gr = genericRowToGridRow(config, r);
    for (const spec of config.rollups ?? []) {
      const anchorField = spec.anchorField ?? config.idField;
      const v = rollupMaps.get(spec.field)?.get(String(r[anchorField]));
      gr.cells[spec.field] = v ?? (spec.op === "count" ? 0 : null);
    }
    return gr;
  });
}

export function genericColumnDefs(config: GenericTableConfig): ColumnDefinition[] {
  const editable = new Set(config.editableFields ?? []);
  const base: ColumnDefinition[] = config.columns.map((c, i) => ({
    columnId: c.field,
    name: c.name,
    fieldType: c.fieldType,
    position: i,
    required: false,
    // editable only if opt-in via editableFields (and never the id field)
    editable: editable.has(c.field) && c.field !== config.idField,
    width: c.width,
    groupable: c.groupable ?? c.fieldType === "select",
    config: c.options ? { options: c.options } : undefined,
    provenanceKind: "system", // a live platform field
  }));
  const rollups: ColumnDefinition[] = (config.rollups ?? []).map((spec, i) => ({
    columnId: spec.field,
    name: spec.name,
    fieldType: "rollup",
    position: config.columns.length + i,
    required: false,
    editable: false, // computed, read-only
    width: spec.width,
    groupable: false,
    provenanceKind: "derived", // calculated from related records
  }));
  return [...base, ...rollups];
}

/** Pull the validated scalar for a Prisma write from a CellStorage by field type. */
function prismaValueFromStorage(fieldType: FieldType, storage: CellStorage): unknown {
  switch (fieldType) {
    case "text":
    case "url":
    case "email":
      return storage.textValue;
    case "number":
      return storage.numberValue;
    case "date":
    case "datetime":
      return storage.dateValue;
    case "checkbox":
      return storage.boolValue;
    case "select":
      return storage.selectValue;
    case "multi_select":
      return storage.multiSelectValue;
    default:
      throw new Error(`Field type "${fieldType}" cannot be edited in a generic grid`);
  }
}

/**
 * Build a validated Prisma `data` object for a generic edit. Throws if a change
 * targets the id field, a non-allow-listed field, an unknown field, or fails
 * validation — fail-closed, no silent drops. Pure (no DB), so it is unit-testable.
 */
export function genericUpdateData(
  config: GenericTableConfig,
  changes: Record<string, CellValue>,
): Record<string, unknown> {
  const editable = new Set(config.editableFields ?? []);
  const byField = new Map(config.columns.map((c) => [c.field, c]));
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(changes)) {
    if (field === config.idField) throw new Error(`The id field "${field}" cannot be edited`);
    if (!editable.has(field)) throw new Error(`Field "${field}" is not editable`);
    const col = byField.get(field);
    if (!col) throw new Error(`Unknown field: ${field}`);
    const result = validateCell(
      {
        name: col.name,
        fieldType: col.fieldType,
        required: false,
        config: col.options ? { options: col.options } : undefined,
      },
      value,
    );
    if (!result.ok) throw new Error(result.error);
    data[field] = prismaValueFromStorage(col.fieldType, result.storage);
  }
  return data;
}

type ReadDelegate = {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  update(args: unknown): Promise<Record<string, unknown>>;
  groupBy(args: unknown): Promise<Record<string, unknown>[]>;
};

function delegate(model: string): ReadDelegate {
  const d = (prisma as unknown as Record<string, ReadDelegate>)[model];
  if (!d || typeof d.findMany !== "function") {
    throw new Error(`Unknown Prisma model for generic grid: ${model}`);
  }
  return d;
}

/** A GroupByRunner backed by the live Prisma client (the production rollup query path). */
const prismaGroupBy: GroupByRunner = (model, args) => delegate(model).groupBy(args);

class GenericReadAdapter implements DataSourceAdapter {
  constructor(private readonly cfg: GenericTableConfig) {}

  get entityType(): string {
    return this.cfg.entityType;
  }

  private select(): Record<string, true> {
    const sel: Record<string, true> = { [this.cfg.idField]: true };
    for (const c of this.cfg.columns) sel[c.field] = true;
    // Rollups join on the anchor field (often the cuid PK), which may not be a column.
    for (const r of this.cfg.rollups ?? []) sel[r.anchorField ?? this.cfg.idField] = true;
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
    const rollupMaps = await resolveRollups(this.cfg, records, prismaGroupBy);
    const rows = buildGridRows(this.cfg, records, rollupMaps);
    const filtered = applyFilters(rows, opts.filters);
    const sorted = applySort(filtered, opts.sort);
    return paginate(sorted, opts.pagination.cursor, opts.pagination.limit);
  }

  async getRow(_entityType: string, rowId: string): Promise<GridRow | null> {
    const r = await delegate(this.cfg.prismaModel).findUnique({
      where: { [this.cfg.idField]: rowId },
      select: this.select(),
    });
    if (!r) return null;
    const rollupMaps = await resolveRollups(this.cfg, [r], prismaGroupBy);
    return buildGridRows(this.cfg, [r], rollupMaps)[0];
  }

  async searchReferences(
    _referenceType: string,
    query: string,
  ): Promise<{ id: string; label: string }[]> {
    const labelField = referenceLabelField(this.cfg);
    const records = await delegate(this.cfg.prismaModel).findMany(
      buildReferenceSearchArgs(this.cfg, query),
    );
    return records.map((r) => ({
      id: String(r[this.cfg.idField]),
      label: String(r[labelField] ?? r[this.cfg.idField]),
    }));
  }

  async resolveReference(
    _referenceType: string,
    referenceId: string,
  ): Promise<ReferenceResolution | null> {
    const labelField = referenceLabelField(this.cfg);
    const r = await delegate(this.cfg.prismaModel).findUnique({
      where: { [this.cfg.idField]: referenceId },
      select: { [this.cfg.idField]: true, [labelField]: true },
    });
    if (!r) return null;
    return { label: String(r[labelField] ?? r[this.cfg.idField]) };
  }

  async updateCells(
    entityType: string,
    rowId: string,
    changes: Record<string, CellValue>,
    ctx: AdapterContext,
  ): Promise<GridRow> {
    if ((this.cfg.editableFields?.length ?? 0) === 0) {
      throw new Error("This data source is read-only");
    }
    if (!ctx.canManage) {
      throw new Error("You do not have permission to edit this data");
    }
    const data = genericUpdateData(this.cfg, changes); // validates; throws fail-closed
    if (this.cfg.writeThrough) {
      // Governed path: the domain action owns the audit log and any domain rules.
      const result = await this.cfg.writeThrough(rowId, data);
      if (!result.ok) throw new Error(result.message);
    } else {
      await delegate(this.cfg.prismaModel).update({
        where: { [this.cfg.idField]: rowId },
        data,
      });
    }
    const row = await this.getRow(entityType, rowId);
    if (!row) throw new Error("Row updated but could not be read back");
    return row;
  }

  getCapabilities(ctx: AdapterContext): GridCapabilities {
    const canEdit = !!ctx.canManage && (this.cfg.editableFields?.length ?? 0) > 0;
    return { canAddRow: false, canAddColumn: false, canEditCell: canEdit, canDeleteRow: false };
  }
}

export function makeGenericReadAdapter(config: GenericTableConfig): DataSourceAdapter {
  return new GenericReadAdapter(config);
}

/** Build + register a generic read-only grid for a Prisma model. */
export function registerGenericReadTable(config: GenericTableConfig): void {
  gridRegistry.register(makeGenericReadAdapter(config));
}
