// Universal Grid & Workbooks — MCP tool handlers (EP-GRID-WORKBOOKS)
// Agents read/write workbook data through the same service + cell validation as
// the UI. Capability gating (view_workbooks / manage_workbooks) is enforced by
// the MCP tool registry before these run; per-workbook share role is enforced
// inside the service.

import { prisma } from "@dpf/db";
import {
  type ServiceUser,
  listWorkbooks,
  getWorkbook,
  getTableSchema,
  queryRows,
  createRow,
  updateCells,
} from "./workbook-service";
import type { CellValue, SortSpec, DataSourceFilter } from "./types";

interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

async function resolveUser(userId: string): Promise<ServiceUser> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperuser: true },
  });
  return { id: userId, isSuperuser: u?.isSuperuser ?? false };
}

function fail(e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message : "Unexpected error";
  return { success: false, message: msg, error: msg };
}

function str(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || !v) throw new Error(`Missing required parameter: ${key}`);
  return v;
}

export async function workbookListTablesTool(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  try {
    const user = await resolveUser(userId);
    const filterWorkbookId = typeof params.workbookId === "string" ? params.workbookId : null;
    const summaries = await listWorkbooks(user);
    const scoped = filterWorkbookId
      ? summaries.filter((w) => w.workbookId === filterWorkbookId)
      : summaries;
    const tables: unknown[] = [];
    for (const wb of scoped) {
      const detail = await getWorkbook(user, wb.workbookId);
      for (const t of detail.tables) {
        tables.push({
          workbookId: wb.workbookId,
          workbookName: wb.name,
          tableId: t.tableId,
          name: t.name,
          dataSource: t.dataSource,
          columnCount: t.columnCount,
        });
      }
    }
    return { success: true, message: `Found ${tables.length} table(s).`, data: { tables } };
  } catch (e) {
    return fail(e);
  }
}

export async function workbookGetSchemaTool(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  try {
    const user = await resolveUser(userId);
    const schema = await getTableSchema(user, str(params, "tableId"));
    return {
      success: true,
      message: `Table "${schema.name}" has ${schema.columns.length} column(s).`,
      data: { schema },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function workbookQueryRowsTool(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  try {
    const user = await resolveUser(userId);
    const tableId = str(params, "tableId");
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const cursor = typeof params.cursor === "string" ? params.cursor : null;
    const sort = Array.isArray(params.sort) ? (params.sort as SortSpec[]) : undefined;
    const filters = (params.filters as DataSourceFilter | undefined) ?? undefined;
    const result = await queryRows(user, tableId, { limit, cursor, sort, filters });
    return {
      success: true,
      message: `Returned ${result.data.length} row(s).`,
      data: { rows: result.data, nextCursor: result.nextCursor },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function workbookCreateRowTool(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  try {
    const user = await resolveUser(userId);
    const tableId = str(params, "tableId");
    const cells = (params.cells as Record<string, CellValue> | undefined) ?? {};
    const row = await createRow(user, tableId, cells);
    return { success: true, message: `Created row ${row.rowId}.`, data: { row } };
  } catch (e) {
    return fail(e);
  }
}

export async function workbookUpdateCellsTool(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  try {
    const user = await resolveUser(userId);
    const tableId = str(params, "tableId");
    const rowId = str(params, "rowId");
    const cells = (params.cells as Record<string, CellValue> | undefined) ?? {};
    const row = await updateCells(user, tableId, rowId, cells);
    return { success: true, message: `Updated row ${row.rowId}.`, data: { row } };
  } catch (e) {
    return fail(e);
  }
}
