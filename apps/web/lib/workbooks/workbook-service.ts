// Universal Grid & Workbooks — service layer (EP-GRID-WORKBOOKS)
//
// Server-only core logic shared by server actions, API routes, and MCP tool
// handlers. Resolves semantic ids (WB-/TBL-) to internal ids, enforces both the
// coarse platform capability (view_workbooks/manage_workbooks) and the
// per-workbook WorkbookShare role, then delegates row/cell work to the registered
// data-source adapter. Phase 1 only registers the "custom" adapter.

import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { z } from "zod";
import { gridRegistry, type AdapterContext } from "./adapter";
import "./custom-table-adapter"; // ensure the custom adapter self-registers
import { genSemanticId } from "./ids";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type FieldType,
  type FieldConfig,
  type ViewConfig,
  type DataSourceFilter,
  type SortSpec,
  type GridCapabilities,
  FIELD_TYPES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_GRID_ROWS,
  emptyViewConfig,
} from "./types";

export type WorkbookRole = "owner" | "editor" | "viewer";

export interface ServiceUser {
  id: string;
  isSuperuser: boolean;
}

export class WorkbookError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "WorkbookError";
  }
}

const ROLE_RANK: Record<WorkbookRole, number> = { viewer: 1, editor: 2, owner: 3 };

function requireRole(role: WorkbookRole | null, min: WorkbookRole): WorkbookRole {
  if (!role || ROLE_RANK[role] < ROLE_RANK[min]) {
    throw new WorkbookError("You do not have access to this workbook", 403);
  }
  return role;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

export const createWorkbookSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  areaSlug: z.string().max(100).optional(),
});

export const createTableSchema = z.object({
  name: z.string().min(1).max(200),
});

const selectOptionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  intent: z.string().optional(),
});

const lookupConfigSchema = z.object({
  referenceColumnId: z.string().min(1),
  targetField: z.string().min(1),
  targetFieldType: z.enum(FIELD_TYPES as unknown as [string, ...string[]]).optional(),
});

const fieldConfigSchema = z
  .object({
    options: z.array(selectOptionSchema).optional(),
    referenceType: z.string().optional(),
    multiline: z.boolean().optional(),
    precision: z.number().optional(),
    formula: z.string().max(2000).optional(),
    resultType: z.enum(FIELD_TYPES as unknown as [string, ...string[]]).optional(),
    lookup: lookupConfigSchema.optional(),
  })
  .optional();

export const addColumnSchema = z
  .object({
    name: z.string().min(1).max(200),
    fieldType: z.enum(FIELD_TYPES as unknown as [string, ...string[]]),
    config: fieldConfigSchema,
    required: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    // Computed columns must carry their definition (fail-closed, not silent).
    if (val.fieldType === "formula" && !val.config?.formula?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A formula is required for a formula column", path: ["config", "formula"] });
    }
    if (val.fieldType === "lookup" && !val.config?.lookup) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A lookup column needs a reference column and target field", path: ["config", "lookup"] });
    }
    if (val.fieldType === "reference" && !val.config?.referenceType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A reference column needs a target entity", path: ["config", "referenceType"] });
    }
  });

// ---------------------------------------------------------------------------
// Access resolution
// ---------------------------------------------------------------------------

/** Resolve a user's role on a workbook (by internal id). Superusers are treated as owner. */
async function resolveWorkbookRole(
  user: ServiceUser,
  internalWorkbookId: string,
): Promise<WorkbookRole | null> {
  if (user.isSuperuser) return "owner";
  const share = await prisma.workbookShare.findUnique({
    where: { workbookId_userId: { workbookId: internalWorkbookId, userId: user.id } },
  });
  return (share?.role as WorkbookRole | undefined) ?? null;
}

interface ResolvedTable {
  internalId: string;
  tableId: string;
  name: string;
  dataSource: string;
  dataSourceFilter: DataSourceFilter | null;
  internalWorkbookId: string;
  role: WorkbookRole;
}

async function resolveTable(
  user: ServiceUser,
  tableId: string,
  minRole: WorkbookRole,
): Promise<ResolvedTable> {
  const table = await prisma.workbookTable.findUnique({ where: { tableId } });
  if (!table) throw new WorkbookError("Table not found", 404);
  const role = requireRole(await resolveWorkbookRole(user, table.workbookId), minRole);
  return {
    internalId: table.id,
    tableId: table.tableId,
    name: table.name,
    dataSource: table.dataSource,
    dataSourceFilter: (table.dataSourceFilter as DataSourceFilter | null) ?? null,
    internalWorkbookId: table.workbookId,
    role,
  };
}

// ---------------------------------------------------------------------------
// Workbook CRUD
// ---------------------------------------------------------------------------

export interface WorkbookSummary {
  workbookId: string;
  name: string;
  description: string;
  areaSlug: string | null;
  role: WorkbookRole;
  tableCount: number;
  updatedAt: string;
}

export async function listWorkbooks(user: ServiceUser): Promise<WorkbookSummary[]> {
  const shares = await prisma.workbookShare.findMany({
    where: user.isSuperuser ? {} : { userId: user.id },
    include: { workbook: { include: { _count: { select: { tables: true } } } } },
    orderBy: { workbook: { updatedAt: "desc" } },
  });
  // de-dup (superuser path could include multiple shares per workbook)
  const seen = new Set<string>();
  const out: WorkbookSummary[] = [];
  for (const s of shares) {
    if (seen.has(s.workbookId)) continue;
    seen.add(s.workbookId);
    out.push({
      workbookId: s.workbook.workbookId,
      name: s.workbook.name,
      description: s.workbook.description,
      areaSlug: s.workbook.areaSlug,
      role: (s.role as WorkbookRole) ?? "viewer",
      tableCount: s.workbook._count.tables,
      updatedAt: s.workbook.updatedAt.toISOString(),
    });
  }
  return out;
}

export async function createWorkbook(
  user: ServiceUser,
  input: z.infer<typeof createWorkbookSchema>,
): Promise<WorkbookSummary> {
  const data = createWorkbookSchema.parse(input);
  const wb = await prisma.workbook.create({
    data: {
      workbookId: genSemanticId("WB"),
      name: data.name,
      description: data.description ?? "",
      areaSlug: data.areaSlug ?? null,
      createdById: user.id,
      shares: { create: { userId: user.id, role: "owner" } },
    },
  });
  return {
    workbookId: wb.workbookId,
    name: wb.name,
    description: wb.description,
    areaSlug: wb.areaSlug,
    role: "owner",
    tableCount: 0,
    updatedAt: wb.updatedAt.toISOString(),
  };
}

export interface TableSummary {
  tableId: string;
  name: string;
  dataSource: string;
  position: number;
  columnCount: number;
}

export interface WorkbookDetail extends WorkbookSummary {
  tables: TableSummary[];
}

export async function getWorkbook(
  user: ServiceUser,
  workbookId: string,
): Promise<WorkbookDetail> {
  const wb = await prisma.workbook.findUnique({
    where: { workbookId },
    include: {
      tables: {
        orderBy: { position: "asc" },
        include: { _count: { select: { columns: true } } },
      },
    },
  });
  if (!wb) throw new WorkbookError("Workbook not found", 404);
  const role = requireRole(await resolveWorkbookRole(user, wb.id), "viewer");
  return {
    workbookId: wb.workbookId,
    name: wb.name,
    description: wb.description,
    areaSlug: wb.areaSlug,
    role,
    tableCount: wb.tables.length,
    updatedAt: wb.updatedAt.toISOString(),
    tables: wb.tables.map((t) => ({
      tableId: t.tableId,
      name: t.name,
      dataSource: t.dataSource,
      position: t.position,
      columnCount: t._count.columns,
    })),
  };
}

export async function deleteWorkbook(user: ServiceUser, workbookId: string): Promise<void> {
  const wb = await prisma.workbook.findUnique({ where: { workbookId } });
  if (!wb) throw new WorkbookError("Workbook not found", 404);
  requireRole(await resolveWorkbookRole(user, wb.id), "owner");
  await prisma.workbook.delete({ where: { id: wb.id } });
}

// ---------------------------------------------------------------------------
// Table + column management (custom tables)
// ---------------------------------------------------------------------------

export async function createTable(
  user: ServiceUser,
  workbookId: string,
  input: z.infer<typeof createTableSchema>,
): Promise<TableSummary> {
  const data = createTableSchema.parse(input);
  const wb = await prisma.workbook.findUnique({ where: { workbookId } });
  if (!wb) throw new WorkbookError("Workbook not found", 404);
  requireRole(await resolveWorkbookRole(user, wb.id), "editor");

  const maxPos = await prisma.workbookTable.aggregate({
    where: { workbookId: wb.id },
    _max: { position: true },
  });
  const table = await prisma.workbookTable.create({
    data: {
      tableId: genSemanticId("TBL"),
      name: data.name,
      workbookId: wb.id,
      dataSource: "custom",
      position: (maxPos._max.position ?? -1) + 1,
    },
  });
  return {
    tableId: table.tableId,
    name: table.name,
    dataSource: table.dataSource,
    position: table.position,
    columnCount: 0,
  };
}

export async function deleteTable(user: ServiceUser, tableId: string): Promise<void> {
  const t = await resolveTable(user, tableId, "editor");
  await prisma.workbookTable.delete({ where: { id: t.internalId } });
}

export async function addColumn(
  user: ServiceUser,
  tableId: string,
  input: z.infer<typeof addColumnSchema>,
): Promise<ColumnDefinition> {
  const data = addColumnSchema.parse(input);
  const t = await resolveTable(user, tableId, "editor");
  if (t.dataSource !== "custom") {
    throw new WorkbookError("Columns can only be added to custom tables", 400);
  }
  const maxPos = await prisma.workbookColumn.aggregate({
    where: { tableId: t.internalId },
    _max: { position: true },
  });
  const col = await prisma.workbookColumn.create({
    data: {
      columnId: genSemanticId("COL"),
      name: data.name,
      tableId: t.internalId,
      fieldType: data.fieldType,
      fieldConfig:
        data.config === undefined ? undefined : (data.config as Prisma.InputJsonValue),
      required: data.required ?? false,
      position: (maxPos._max.position ?? -1) + 1,
    },
  });
  return {
    columnId: col.columnId,
    name: col.name,
    fieldType: col.fieldType as FieldType,
    position: col.position,
    required: col.required,
    width: col.width ?? undefined,
    config: (col.fieldConfig as FieldConfig | null) ?? undefined,
    editable: true,
    groupable: (col.fieldType as FieldType) === "select",
  };
}

export async function deleteColumn(user: ServiceUser, tableId: string, columnId: string): Promise<void> {
  const t = await resolveTable(user, tableId, "editor");
  const col = await prisma.workbookColumn.findUnique({ where: { columnId } });
  if (!col || col.tableId !== t.internalId) throw new WorkbookError("Column not found", 404);
  await prisma.workbookColumn.delete({ where: { id: col.id } });
}

// ---------------------------------------------------------------------------
// Schema + rows (delegates to the adapter)
// ---------------------------------------------------------------------------

export interface TableSchemaResult {
  tableId: string;
  name: string;
  dataSource: string;
  columns: ColumnDefinition[];
  capabilities: GridCapabilities;
}

export async function getTableSchema(
  user: ServiceUser,
  tableId: string,
): Promise<TableSchemaResult> {
  const t = await resolveTable(user, tableId, "viewer");
  const adapter = gridRegistry.require(t.dataSource);
  const ctx: AdapterContext = { userId: user.id, workbookRole: t.role };
  const columns = await adapter.getColumns(t.internalId);
  return {
    tableId: t.tableId,
    name: t.name,
    dataSource: t.dataSource,
    columns,
    capabilities: adapter.getCapabilities(ctx),
  };
}

export async function queryRows(
  user: ServiceUser,
  tableId: string,
  opts: { filters?: DataSourceFilter; sort?: SortSpec[]; cursor?: string | null; limit?: number },
): Promise<{ data: GridRow[]; nextCursor: string | null }> {
  const t = await resolveTable(user, tableId, "viewer");
  const adapter = gridRegistry.require(t.dataSource);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  // Merge the table's pre-filter with the caller's view filter.
  const filters: DataSourceFilter = {
    conditions: [
      ...(t.dataSourceFilter?.conditions ?? []),
      ...(opts.filters?.conditions ?? []),
    ],
    logic: opts.filters?.logic ?? "and",
  };
  return adapter.queryRows(t.internalId, {
    filters,
    sort: opts.sort ?? [],
    pagination: { cursor: opts.cursor ?? null, limit },
  });
}

export async function createRow(
  user: ServiceUser,
  tableId: string,
  input: Record<string, CellValue>,
): Promise<GridRow> {
  const t = await resolveTable(user, tableId, "editor");
  const adapter = gridRegistry.require(t.dataSource);
  if (!adapter.createRow) throw new WorkbookError("This data source is read-only", 400);
  return adapter.createRow(t.internalId, input, { userId: user.id, workbookRole: t.role });
}

export async function updateCells(
  user: ServiceUser,
  tableId: string,
  rowId: string,
  changes: Record<string, CellValue>,
): Promise<GridRow> {
  const t = await resolveTable(user, tableId, "editor");
  const adapter = gridRegistry.require(t.dataSource);
  if (!adapter.updateCells) throw new WorkbookError("This data source is read-only", 400);
  return adapter.updateCells(t.internalId, rowId, changes, {
    userId: user.id,
    workbookRole: t.role,
  });
}

export async function deleteRow(
  user: ServiceUser,
  tableId: string,
  rowId: string,
): Promise<void> {
  const t = await resolveTable(user, tableId, "editor");
  const adapter = gridRegistry.require(t.dataSource);
  if (!adapter.deleteRow) throw new WorkbookError("This data source is read-only", 400);
  await adapter.deleteRow(t.internalId, rowId, { userId: user.id, workbookRole: t.role });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export async function listViews(
  user: ServiceUser,
  tableId: string,
): Promise<{ viewId: string; name: string; viewType: string; config: ViewConfig; isDefault: boolean }[]> {
  const t = await resolveTable(user, tableId, "viewer");
  const views = await prisma.workbookView.findMany({
    where: { tableId: t.internalId },
    orderBy: { createdAt: "asc" },
  });
  return views.map((v) => ({
    viewId: v.viewId,
    name: v.name,
    viewType: v.viewType,
    config: v.config as unknown as ViewConfig,
    isDefault: v.isDefault,
  }));
}

export async function saveView(
  user: ServiceUser,
  tableId: string,
  input: { name: string; config: ViewConfig; viewType?: string; isDefault?: boolean },
): Promise<{ viewId: string }> {
  const t = await resolveTable(user, tableId, "editor");
  const view = await prisma.workbookView.create({
    data: {
      viewId: genSemanticId("VW"),
      name: input.name,
      tableId: t.internalId,
      viewType: input.viewType ?? "grid",
      config: input.config as unknown as Prisma.InputJsonValue,
      isDefault: input.isDefault ?? false,
      createdById: user.id,
    },
  });
  return { viewId: view.viewId };
}

/**
 * Convenience for the UI: schema + EVERY row + a default view config. Loads all
 * rows (paginating through cursors, capped at MAX_GRID_ROWS) so the client grid —
 * which filters, sorts, groups and exports over the rows it holds — reflects the
 * whole table, not just the first page. `nextCursor` is non-null only if the cap
 * was hit.
 */
export async function getTableGridData(
  user: ServiceUser,
  tableId: string,
): Promise<{
  schema: TableSchemaResult;
  rows: GridRow[];
  nextCursor: string | null;
  view: ViewConfig;
}> {
  const schema = await getTableSchema(user, tableId);
  const rows: GridRow[] = [];
  let cursor: string | null = null;
  do {
    const { data, nextCursor } = await queryRows(user, tableId, { cursor, limit: MAX_PAGE_SIZE });
    rows.push(...data);
    cursor = nextCursor;
    // Guard against a stuck cursor that never returns rows or never clears.
    if (data.length === 0) break;
  } while (cursor && rows.length < MAX_GRID_ROWS);
  return { schema, rows, nextCursor: cursor, view: emptyViewConfig(schema.columns) };
}
