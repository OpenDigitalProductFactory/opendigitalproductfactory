// Workbook authoring (red stub).
import type { ColumnDefinition, FieldConfig, FieldType } from "./types";
import type { PlatformUser } from "./platform-tables";

export interface CreatedView {
  viewId: string;
  name: string;
  viewType: "grid" | "kanban";
  tableId: string;
  workbookId: string;
}

export async function addTypedColumn(
  _user: PlatformUser,
  _tableId: string,
  _input: { name: string; fieldType: FieldType; config?: FieldConfig; required?: boolean },
): Promise<ColumnDefinition> {
  throw new Error("not implemented");
}

export async function createTableView(
  _user: PlatformUser,
  _tableId: string,
  _input: { name: string; viewType: "grid" | "kanban"; groupByColumnId?: string; cardFields?: string[]; isDefault?: boolean },
): Promise<CreatedView> {
  throw new Error("not implemented");
}
