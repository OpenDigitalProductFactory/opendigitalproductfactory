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
  getTableGridData as svcGetTableGridData,
} from "@/lib/workbooks/workbook-service";
import {
  type PlatformUser,
  type ReferenceTarget,
  listReferenceTargets,
  searchPlatformReferences,
  resolvePlatformReference,
} from "@/lib/workbooks/platform-tables";
import type { CellValue, ColumnDefinition, FieldType, FieldConfig } from "@/lib/workbooks/types";

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? Record<string, never> : { data: T }))
  | { ok: false; error: string };

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
  if (e instanceof WorkbookError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : "Unexpected error" };
}

export async function listWorkbooksAction(): Promise<ActionResult<WorkbookSummary[]>> {
  try {
    const user = await requireUser("view_workbooks");
    return { ok: true, data: await svcListWorkbooks(user) };
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
    return { ok: true, data: wb };
  } catch (e) {
    return fail(e);
  }
}

export async function getWorkbookAction(workbookId: string): Promise<ActionResult<WorkbookDetail>> {
  try {
    const user = await requireUser("view_workbooks");
    return { ok: true, data: await svcGetWorkbook(user, workbookId) };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteWorkbookAction(workbookId: string): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcDeleteWorkbook(user, workbookId);
    revalidatePath("/workbooks");
    return { ok: true } as ActionResult;
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
    return { ok: true, data: table };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTableAction(workbookId: string, tableId: string): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcDeleteTable(user, tableId);
    revalidatePath(`/workbooks/${workbookId}`);
    return { ok: true } as ActionResult;
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
    return { ok: true, data: col };
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
    return { ok: true } as ActionResult;
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
    return { ok: true, data: { rowId: row.rowId } };
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
    return { ok: true, data: { rowId: row.rowId } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteRowAction(tableId: string, rowId: string): Promise<ActionResult> {
  try {
    const user = await requireUser("manage_workbooks");
    await svcDeleteRow(user, tableId, rowId);
    return { ok: true } as ActionResult;
  } catch (e) {
    return fail(e);
  }
}

export async function getTableGridDataAction(tableId: string): Promise<
  ActionResult<Awaited<ReturnType<typeof svcGetTableGridData>>>
> {
  try {
    const user = await requireUser("view_workbooks");
    return { ok: true, data: await svcGetTableGridData(user, tableId) };
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
    return { ok: true, data: listReferenceTargets(user) };
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
    return { ok: true, data: await searchPlatformReferences(user, referenceType, query) };
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
    return { ok: true, data: await resolvePlatformReference(user, referenceType, referenceId) };
  } catch (e) {
    return fail(e);
  }
}
