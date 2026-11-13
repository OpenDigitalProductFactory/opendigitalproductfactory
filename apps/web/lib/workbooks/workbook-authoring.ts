// Universal Grid & Workbooks — schema authoring for people and coworkers (BI-FE8DF004).
//
// One governed path for adding a typed column and creating a view, shared by the
// UI server actions and the MCP authoring tools. It layers the table-aware rules
// (./column-rules, ./view-authoring) over the service, which still owns the
// per-workbook WorkbookShare check (editor or above to author) and the writes.
//
// Workbook has no organization column: its boundary is its share set. A caller
// who is not an editor of the workbook is refused, with the service's message,
// before the table's columns are used or anything is written.

import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { listReferenceTargets, type PlatformUser } from "./platform-tables";
import { addColumn, getTableSchema, listViews, saveView, WorkbookError, addColumnSchema } from "./workbook-service";
import { columnRuleViolation } from "./column-rules";
import { buildViewConfig, type AuthoredViewType } from "./view-authoring";
import { normalizeName } from "./formula/evaluate";
import type { ColumnDefinition, FieldConfig, FieldType } from "./types";

export interface CreatedView {
  viewId: string;
  name: string;
  viewType: AuthoredViewType;
  tableId: string;
  workbookId: string;
}

const NO_ACCESS = "You do not have access to this workbook";

/** The table's columns, refusing anyone below editor (same message as the service). */
async function editableColumns(user: PlatformUser, tableId: string): Promise<ColumnDefinition[]> {
  const schema = await getTableSchema(user, tableId);
  if (!schema.capabilities.canAddColumn) throw new WorkbookError(NO_ACCESS, 403);
  return schema.columns;
}

/** Add a typed column after checking it against its table and the caller's reach. */
export async function addTypedColumn(
  user: PlatformUser,
  tableId: string,
  input: { name: string; fieldType: FieldType; config?: FieldConfig; required?: boolean },
): Promise<ColumnDefinition> {
  const data = addColumnSchema.parse(input);
  const columns = await editableColumns(user, tableId);
  const targets = listReferenceTargets(user).map((t) => t.entityType);
  const problem = columnRuleViolation(
    { fieldType: data.fieldType as FieldType, name: data.name, config: data.config as FieldConfig | undefined },
    columns,
    targets,
  );
  if (problem) throw new WorkbookError(problem, 400);
  return addColumn(user, tableId, data);
}

/** Create a grid or kanban view. Refuses a name already used on the table. */
export async function createTableView(
  user: PlatformUser,
  tableId: string,
  input: {
    name: string;
    viewType: AuthoredViewType;
    groupByColumnId?: string;
    cardFields?: string[];
    isDefault?: boolean;
  },
): Promise<CreatedView> {
  const name = input.name?.trim() ?? "";
  if (!name) throw new WorkbookError("A view name is required", 400);
  const columns = await editableColumns(user, tableId);
  let built;
  try {
    built = buildViewConfig(input, columns);
  } catch (e) {
    throw new WorkbookError(e instanceof Error ? e.message : "Invalid view", 400);
  }
  const existing = await listViews(user, tableId);
  if (existing.some((v) => normalizeName(v.name) === normalizeName(name))) {
    throw new WorkbookError(`This table already has a view named "${name}"`, 409);
  }
  const { viewId } = await saveView(user, tableId, {
    name,
    viewType: built.viewType,
    config: built.config as Prisma.InputJsonValue,
    isDefault: input.isDefault,
  });

  const table = await prisma.workbookTable.findUnique({ where: { tableId } });
  const workbook = table ? await prisma.workbook.findUnique({ where: { id: table.workbookId } }) : null;
  return { viewId, name, viewType: built.viewType, tableId, workbookId: workbook?.workbookId ?? "" };
}
