// Universal Grid & Workbooks — MCP schema-authoring handlers (BI-FE8DF004).
//
// workbook_create / workbook_create_table / workbook_add_column /
// workbook_create_view. The caller's userId is the person the coworker acts for,
// so a created workbook is theirs (owner share), exactly as the UI's
// createWorkbookAction makes it the signed-in person's. The registry has already
// checked manage_workbooks and the coworker's workbook_write grant; the service
// enforces the per-workbook share role on every call.

import { prisma } from "@dpf/db";
import { createWorkbook, createTable, type ServiceUser } from "./workbook-service";
import { addTypedColumn, createTableView } from "./workbook-authoring";
import type { PlatformUser } from "./platform-tables";
import type { FieldConfig, FieldType } from "./types";
import type { AuthoredViewType } from "./view-authoring";

interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

async function resolveActor(userId: string): Promise<PlatformUser> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperuser: true, platformRole: true },
  });
  return { id: userId, isSuperuser: u?.isSuperuser ?? false, platformRole: u?.platformRole ?? null };
}

function serviceUser(actor: PlatformUser): ServiceUser {
  return { id: actor.id, isSuperuser: actor.isSuperuser };
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

function optStr(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" && v ? v : undefined;
}

export async function workbookCreateTool(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  try {
    const actor = await resolveActor(userId);
    const description = optStr(params, "description");
    const workbook = await createWorkbook(serviceUser(actor), {
      name: str(params, "name"),
      ...(description ? { description } : {}),
    });
    return {
      success: true,
      message: `Created workbook ${workbook.workbookId} "${workbook.name}".`,
      data: { workbook, url: `/workbooks/${workbook.workbookId}` },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function workbookCreateTableTool(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  try {
    const actor = await resolveActor(userId);
    const workbookId = str(params, "workbookId");
    const table = await createTable(serviceUser(actor), workbookId, { name: str(params, "name") });
    return {
      success: true,
      message: `Created table ${table.tableId} "${table.name}".`,
      data: { table, url: `/workbooks/${workbookId}?table=${table.tableId}` },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function workbookAddColumnTool(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  try {
    const actor = await resolveActor(userId);
    const config = params.config && typeof params.config === "object" ? (params.config as FieldConfig) : undefined;
    const column = await addTypedColumn(actor, str(params, "tableId"), {
      name: str(params, "name"),
      fieldType: str(params, "fieldType") as FieldType,
      ...(config ? { config } : {}),
      ...(typeof params.required === "boolean" ? { required: params.required } : {}),
    });
    return {
      success: true,
      message: `Added ${column.fieldType} column ${column.columnId} "${column.name}".`,
      data: { column },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function workbookCreateViewTool(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  try {
    const actor = await resolveActor(userId);
    const tableId = str(params, "tableId");
    const cardFields = Array.isArray(params.cardFields)
      ? params.cardFields.filter((v): v is string => typeof v === "string")
      : undefined;
    const view = await createTableView(actor, tableId, {
      name: str(params, "name"),
      viewType: str(params, "viewType") as AuthoredViewType,
      groupByColumnId: optStr(params, "groupByColumnId"),
      cardFields,
      isDefault: typeof params.isDefault === "boolean" ? params.isDefault : undefined,
    });
    const url = `/workbooks/${view.workbookId}?table=${tableId}&view=${view.viewId}`;
    return { success: true, message: `Created ${view.viewType} view ${view.viewId} "${view.name}".`, data: { view, url } };
  } catch (e) {
    return fail(e);
  }
}
