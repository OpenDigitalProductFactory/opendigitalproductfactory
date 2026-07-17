"use server";

// Universal Grid & Workbooks — server actions (EP-GRID-WORKBOOKS)
// Thin auth + capability wrappers over the workbook service. Used by the
// Workbooks UI (hub + grid pages). API routes and MCP tools reuse the same
// service directly with their own auth.

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  type ServiceUser,
  type WorkbookSummary,
  type WorkbookDetail,
  type TableSummary,
  WorkbookError,
  createWorkbook as svcCreateWorkbook,
  listWorkbooks as svcListWorkbooks,
  getWorkbook as svcGetWorkbook,
  deleteWorkbook as svcDeleteWorkbook,
  createTable as svcCreateTable,
  deleteTable as svcDeleteTable,
  addColumn as svcAddColumn,
  deleteColumn as svcDeleteColumn,
  createRow as svcCreateRow,
  updateCells as svcUpdateCells,
  deleteRow as svcDeleteRow,
  reorderRows as svcReorderRows,
  getTableGridData as svcGetTableGridData,
  getTableSchema as svcGetTableSchema,
  queryRows as svcQueryRows,
  listViews as svcListViews,
  saveView as svcSaveView,
  deleteView as svcDeleteView,
  setDefaultView as svcSetDefaultView,
  type SavedView,
} from "@/lib/workbooks/workbook-service";
import type { Prisma } from "@dpf/db";
import {
  type PlatformUser,
  type ReferenceTarget,
  type ReferenceFieldOption,
  listReferenceTargets,
  searchPlatformReferences,
  resolvePlatformReference,
  getReferenceTargetFields,
} from "@/lib/workbooks/platform-tables";
import { inferTableFromSheet, type SheetCell } from "@/lib/workbooks/sheet-import";
import { parseDelimitedGrid } from "@/lib/onboarding/roster-import";
import { mapGridToEmployees } from "@/lib/onboarding/roster-from-grid";
import { importRoster } from "@/lib/onboarding/roster-import-actions";
import type { CellValue, ColumnDefinition, FieldType, FieldConfig, GridRow } from "@/lib/workbooks/types";
import { ok, err, type ActionResult } from "@/lib/shared/action-result";

// NOTE: do NOT `export type { ActionResult }` from this "use server" module.
// Next/turbopack enumerates EVERY export of a "use server" file into the
// runtime server-reference registry (ensureServerEntryExports /
// registerServerReference); a type export therefore compiles to a reference to
// an identifier that doesn't exist at runtime → `ReferenceError: ActionResult
// is not defined` at module eval → 500 on every importing route (e.g. the
// coworker conversation load on /ops and /employee, which pull in the Grid).
// The type has no importers here; callers import it from @/lib/shared/action-result.

async function requireUser(capability: "view_workbooks" | "manage_workbooks"): Promise<ServiceUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new WorkbookError("Not authenticated", 401);
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, capability)) {
    throw new WorkbookError("You do not have permission to use Workbooks", 403);
  }
  return { id: user.id, isSuperuser: user.isSuperuser };
}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof WorkbookError) return err(e.message);
  return err(e instanceof Error ? e.message : "Unexpected error");
}

export async function listWorkbooksAction(): Promise<ActionResult<WorkbookSummary[]>> {
  try {
    const user = await requireUser("view_workbooks");
    return ok(await svcListWorkbooks(user));
  } catch (e) {
    return fail(e);
  }
}

export async function createWorkbookAction(input: {
  name: string;
  description?: string;
  areaSlug?: string;
}): Promise<ActionResult<WorkbookSummary>> {
  try {
    const user = await requireUser("manage_workbooks");
    const wb = await svcCreateWorkbook(user, input);
    revalidatePath("/workbooks");
    return ok(wb);
  } catch (e) {
    return fail(e);
  }
}

export async function getWorkbookAction(workbookId: string): Promise<ActionResult<WorkbookDetail>> {
  try {
    const user = await requireUser("view_workbooks");
    return ok(await svcGetWorkbook(user, workbookId));
  } catch (e) {
    return fail(e);
  }
}

export async function deleteWorkbookAction(workbookId: string): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcDeleteWorkbook(user, workbookId);
    revalidatePath("/workbooks");
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function createTableAction(
  workbookId: string,
  input: { name: string },
): Promise<ActionResult<TableSummary>> {
  try {
    const user = await requireUser("manage_workbooks");
    const table = await svcCreateTable(user, workbookId, input);
    revalidatePath(`/workbooks/${workbookId}`);
    return ok(table);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTableAction(workbookId: string, tableId: string): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcDeleteTable(user, tableId);
    revalidatePath(`/workbooks/${workbookId}`);
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function addColumnAction(
  workbookId: string,
  tableId: string,
  input: { name: string; fieldType: FieldType; config?: FieldConfig; required?: boolean },
): Promise<ActionResult<ColumnDefinition>> {
  try {
    const user = await requireUser("manage_workbooks");
    const col = await svcAddColumn(user, tableId, input);
    revalidatePath(`/workbooks/${workbookId}`);
    return ok(col);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteColumnAction(
  workbookId: string,
  tableId: string,
  columnId: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcDeleteColumn(user, tableId, columnId);
    revalidatePath(`/workbooks/${workbookId}`);
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function createRowAction(
  tableId: string,
  input: Record<string, CellValue>,
): Promise<ActionResult<{ rowId: string }>> {
  try {
    const user = await requireUser("manage_workbooks");
    const row = await svcCreateRow(user, tableId, input);
    return ok({ rowId: row.rowId });
  } catch (e) {
    return fail(e);
  }
}

export async function updateCellsAction(
  tableId: string,
  rowId: string,
  changes: Record<string, CellValue>,
): Promise<ActionResult<{ rowId: string }>> {
  try {
    const user = await requireUser("manage_workbooks");
    const row = await svcUpdateCells(user, tableId, rowId, changes);
    return ok({ rowId: row.rowId });
  } catch (e) {
    return fail(e);
  }
}

export async function deleteRowAction(tableId: string, rowId: string): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcDeleteRow(user, tableId, rowId);
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function reorderRowsAction(
  tableId: string,
  orderedRowIds: string[],
): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcReorderRows(user, tableId, orderedRowIds);
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function getTableGridDataAction(tableId: string): Promise<
  ActionResult<Awaited<ReturnType<typeof svcGetTableGridData>>>
> {
  try {
    const user = await requireUser("view_workbooks");
    return ok(await svcGetTableGridData(user, tableId));
  } catch (e) {
    return fail(e);
  }
}

// ── Saved views (Phase 3) ───────────────────────────────────────────────────
// Named views on custom workbook tables persist server-side (shared across
// everyone with table access). Platform grids use a client-side (localStorage)
// store instead — same UI, different backend — so these actions are only invoked
// for custom tables. `config` is the opaque grid view-state blob.

export async function listViewsAction(tableId: string): Promise<ActionResult<SavedView[]>> {
  try {
    const user = await requireUser("view_workbooks");
    return ok(await svcListViews(user, tableId));
  } catch (e) {
    return fail(e);
  }
}

export async function saveViewAction(
  tableId: string,
  input: { name: string; config: unknown; viewType?: string; isDefault?: boolean },
): Promise<ActionResult<{ viewId: string }>> {
  try {
    const user = await requireUser("manage_workbooks");
    return ok(
      await svcSaveView(user, tableId, {
        name: input.name,
        config: input.config as Prisma.InputJsonValue,
        viewType: input.viewType,
        isDefault: input.isDefault,
      }),
    );
  } catch (e) {
    return fail(e);
  }
}

export async function deleteViewAction(tableId: string, viewId: string): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcDeleteView(user, tableId, viewId);
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function setDefaultViewAction(
  tableId: string,
  viewId: string | null,
): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcSetDefaultView(user, tableId, viewId);
    return ok();
  } catch (e) {
    return fail(e);
  }
}

// ── Reference columns (Phase 2) ─────────────────────────────────────────────
// A reference column points a workbook cell at a live platform entity. These
// actions back the add-column target picker and the in-cell typeahead. Auth
// requires view_workbooks; each target re-checks its own view capability.

async function requirePlatformUser(): Promise<PlatformUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new WorkbookError("Not authenticated", 401);
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_workbooks")) {
    throw new WorkbookError("You do not have permission to use Workbooks", 403);
  }
  return { id: user.id, platformRole: user.platformRole, isSuperuser: user.isSuperuser };
}

export async function listReferenceTargetsAction(): Promise<ActionResult<ReferenceTarget[]>> {
  try {
    const user = await requirePlatformUser();
    return ok(listReferenceTargets(user));
  } catch (e) {
    return fail(e);
  }
}

export async function searchReferencesAction(
  referenceType: string,
  query: string,
): Promise<ActionResult<{ id: string; label: string }[]>> {
  try {
    const user = await requirePlatformUser();
    return ok(await searchPlatformReferences(user, referenceType, query));
  } catch (e) {
    return fail(e);
  }
}

export async function resolveReferenceAction(
  referenceType: string,
  referenceId: string,
): Promise<ActionResult<{ id: string; label: string } | null>> {
  try {
    const user = await requirePlatformUser();
    return ok(await resolvePlatformReference(user, referenceType, referenceId));
  } catch (e) {
    return fail(e);
  }
}

export async function getReferenceTargetFieldsAction(
  referenceType: string,
): Promise<ActionResult<ReferenceFieldOption[]>> {
  try {
    const user = await requirePlatformUser();
    return ok(await getReferenceTargetFields(user, referenceType));
  } catch (e) {
    return fail(e);
  }
}

// ── Spreadsheet import (Phase 3) ────────────────────────────────────────────
// Parse an uploaded .xlsx/.csv server-side and create a workbook table with
// inferred columns + typed rows, composing the same validated service the manual
// flow uses (createTable → addColumn → createRow).

export async function importSheetAction(
  workbookId: string,
  formData: FormData,
): Promise<ActionResult<{ tableId: string; columnCount: number; rowCount: number; truncated: boolean }>> {
  try {
    const user = await requireUser("manage_workbooks");
    const file = formData.get("file");
    if (!(file instanceof File)) throw new WorkbookError("No file uploaded", 400);
    const lower = file.name.toLowerCase();
    let matrix: SheetCell[][];
    if (lower.endsWith(".csv") || lower.endsWith(".tsv") || file.type === "text/csv") {
      // CSV/TSV: parse to a string matrix (header row + data rows).
      const text = Buffer.from(await file.arrayBuffer()).toString("utf-8");
      const { columns, rows } = parseDelimitedGrid(text);
      matrix = [columns, ...rows];
    } else {
      const buffer = await file.arrayBuffer();
      const { readSheet } = await import(/* turbopackIgnore: true */ "read-excel-file/browser");
      matrix = (await readSheet(buffer)) as SheetCell[][];
    }

    const { columns, rows, truncated } = inferTableFromSheet(matrix);
    if (columns.length === 0) throw new WorkbookError("The sheet has no columns to import", 400);

    const tableName = file.name.replace(/\.[^.]+$/, "").trim() || "Imported sheet";
    const table = await svcCreateTable(user, workbookId, { name: tableName });

    const columnIdByName = new Map<string, string>();
    for (const col of columns) {
      const created = await svcAddColumn(user, table.tableId, { name: col.name, fieldType: col.fieldType });
      columnIdByName.set(col.name, created.columnId);
    }

    for (const row of rows) {
      const input: Record<string, CellValue> = {};
      for (const [name, value] of Object.entries(row)) {
        const columnId = columnIdByName.get(name);
        if (columnId) input[columnId] = value;
      }
      await svcCreateRow(user, table.tableId, input);
    }

    revalidatePath(`/workbooks/${workbookId}`);
    return {
      ok: true,
      data: { tableId: table.tableId, columnCount: columns.length, rowCount: rows.length, truncated },
    };
  } catch (e) {
    return fail(e);
  }
}

// EP-ONBOARDING-INTAKE P4 (grid convergence): create EmployeeProfile rows from a
// workbook table the operator imported + edited in the grid. Reads the table's
// current columns + rows, maps them with the same roster mapper as the CSV path,
// and creates employees (dedup by work email, fail-soft). The grid edit IS the
// review step — nothing is created until the operator clicks "Create employees".
export async function createEmployeesFromTableAction(
  tableId: string,
): Promise<
  ActionResult<{ created: number; skippedExisting: number; failed: number; proposed: number; summary: string }>
> {
  try {
    const user = await requireUser("manage_workbooks");
    const schema = await svcGetTableSchema(user, tableId);

    // Read every row (paged), capped so a giant sheet can't run unbounded.
    const MAX_ROWS = 5000;
    const rows: GridRow[] = [];
    let cursor: string | null = null;
    do {
      const page = await svcQueryRows(user, tableId, { cursor, limit: 200 });
      rows.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor && rows.length < MAX_ROWS);

    const mapped = mapGridToEmployees(schema.columns, rows.slice(0, MAX_ROWS));
    const result = await importRoster(mapped.proposed);
    return {
      ok: true,
      data: {
        created: result.created,
        skippedExisting: result.skippedExisting,
        failed: result.failed,
        proposed: mapped.proposed.length,
        summary: mapped.summary,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

// Onboarding entry for the roster→grid flow (EP-ONBOARDING-INTAKE P4): drop an
// uploaded team spreadsheet into a "Team" workbook as an editable grid table and
// return its ids so the caller can open the grid. The operator then edits and
// clicks "Create employees from this sheet". Find-or-creates the workbook so
// repeat imports land in the same place.
export async function startTeamSheetImportAction(
  formData: FormData,
): Promise<ActionResult<{ workbookId: string; tableId: string }>> {
  try {
    const user = await requireUser("manage_workbooks");
    const existing = await svcListWorkbooks(user);
    let workbookId = existing.find((w) => w.name === "Team")?.workbookId;
    if (!workbookId) {
      const wb = await svcCreateWorkbook(user, {
        name: "Team",
        description: "Imported team rosters — edit in the grid, then create employees.",
      });
      workbookId = wb.workbookId;
    }
    const imported = await importSheetAction(workbookId, formData);
    if (!imported.ok) return imported;
    return ok({ workbookId, tableId: imported.data.tableId });
  } catch (e) {
    return fail(e);
  }
}
