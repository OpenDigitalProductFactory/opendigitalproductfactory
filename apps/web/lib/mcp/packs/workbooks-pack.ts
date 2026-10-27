// Workbooks tool pack — BI-ARCH-TOOLPACKS.
//
// Fourth domain pack (third lazy one), and the last clean lazy domain. Handlers
// live in @/lib/workbooks/mcp-handlers and were dynamically imported per switch
// case; each handler here is a thin wrapper that lazy-imports the module only
// when the tool is called (all take params + userId). Definitions moved
// verbatim out of the inline PLATFORM_TOOLS array.
//
// Schema authoring (BI-FE8DF004): workbook_create, workbook_create_table,
// workbook_add_column and workbook_create_view mirror the UI's create actions
// one-for-one over the same service, so a coworker builds a tracker the way a
// person does. `grants` IS the TOOL_TO_GRANTS source (workbook-tool-grants.ts).

import type { ToolDefinition } from "@/lib/mcp-tool-types";
import { WORKBOOK_TOOL_GRANTS } from "@/lib/tak/workbook-tool-grants";
import { FIELD_TYPES } from "@/lib/workbooks/types";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "workbook_list_tables",
    description: "List the Workbook tables the agent can access (grid/spreadsheet data). Read-only. Pass workbookId to scope to one workbook.",
    inputSchema: {
      type: "object",
      properties: {
        workbookId: { type: "string", description: "Optional semantic workbook id (WB-*) to scope to." },
      },
      required: [],
    },
    requiredCapability: "view_workbooks",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "workbook_get_schema",
    description: "Get a Workbook table's column definitions and the agent's capabilities on it. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "Semantic table id (TBL-*)." },
      },
      required: ["tableId"],
    },
    requiredCapability: "view_workbooks",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "workbook_query_rows",
    description: "Query rows from a Workbook table with optional sort/filter and cursor pagination. Read-only. Cells are keyed by columnId (COL-*).",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "Semantic table id (TBL-*)." },
        limit: { type: "number", description: "Max rows (default 50, max 200)." },
        cursor: { type: "string", description: "Pagination cursor (rowId of the last row from the previous page)." },
        sort: {
          type: "array",
          description: "Sort specs.",
          items: {
            type: "object",
            properties: {
              columnId: { type: "string" },
              direction: { type: "string", enum: ["asc", "desc"] },
            },
          },
        },
      },
      required: ["tableId"],
    },
    requiredCapability: "view_workbooks",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "workbook_create_row",
    description: "Insert a new row into a custom Workbook table. cells is a map of columnId (COL-*) to value; values are validated against each column's field type.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "Semantic table id (TBL-*)." },
        cells: { type: "object", description: "Map of columnId -> value.", additionalProperties: true },
      },
      required: ["tableId"],
    },
    requiredCapability: "manage_workbooks",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "workbook_update_cells",
    description: "Update specific cells in a Workbook row. cells is a map of columnId (COL-*) to new value, validated against each column's field type.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "Semantic table id (TBL-*)." },
        rowId: { type: "string", description: "Semantic row id (ROW-*)." },
        cells: { type: "object", description: "Map of columnId -> new value.", additionalProperties: true },
      },
      required: ["tableId", "rowId"],
    },
    requiredCapability: "manage_workbooks",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "workbook_create",
    description: "Create a Workbook owned by the person you act for. Returns its id (WB-*) and the page where they can open it. Add tables with workbook_create_table.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workbook name (1-200 characters)." },
        description: { type: "string", description: "Optional description shown under the name." },
      },
      required: ["name"],
    },
    requiredCapability: "manage_workbooks",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "workbook_create_table",
    description: "Create an empty table in a Workbook you can edit. Returns its id (TBL-*). Add typed columns with workbook_add_column.",
    inputSchema: {
      type: "object",
      properties: {
        workbookId: { type: "string", description: "Semantic workbook id (WB-*)." },
        name: { type: "string", description: "Table name (1-200 characters)." },
      },
      required: ["workbookId", "name"],
    },
    requiredCapability: "manage_workbooks",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "workbook_add_column",
    description:
      "Add a typed column to a Workbook table you can edit. config depends on fieldType: select/multi_select need options [{key,label}]; reference needs referenceType; link needs link {cardinality one|many, referenceType}; formula needs formula over other column names (e.g. \"[Estimate] - [Spent]\") and optional resultType; lookup needs lookup {referenceColumnId, targetField}; rollup needs rollup {linkColumnId, op count}. Number-like types accept precision, currencySymbol, durationUnit or max. Invalid targets, unknown column names and duplicate names are refused with the reason.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "Semantic table id (TBL-*)." },
        name: { type: "string", description: "Column name, unique on the table." },
        fieldType: { type: "string", enum: [...FIELD_TYPES], description: "The column's type." },
        config: { type: "object", description: "Type-specific configuration (see description).", additionalProperties: true },
        required: { type: "boolean", description: "Whether a value is required on new rows." },
      },
      required: ["tableId", "name", "fieldType"],
    },
    requiredCapability: "manage_workbooks",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "workbook_create_view",
    description:
      "Create a named view on a Workbook table you can edit: grid, or kanban grouped by a select column (one lane per option). Returns the link a person opens to see it. A name already used on the table is refused.",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "Semantic table id (TBL-*)." },
        name: { type: "string", description: "View name, unique on the table." },
        viewType: { type: "string", enum: ["grid", "kanban"], description: "grid or kanban." },
        groupByColumnId: { type: "string", description: "kanban: the select column (COL-*) whose options become lanes." },
        cardFields: { type: "array", items: { type: "string" }, description: "kanban: column ids (COL-*) shown on each card; defaults to the title and up to three more." },
        isDefault: { type: "boolean", description: "Open this view by default for the table." },
      },
      required: ["tableId", "name", "viewType"],
    },
    requiredCapability: "manage_workbooks",
    executionMode: "immediate",
    sideEffect: true,
  },
];

const HANDLERS = () => import("@/lib/workbooks/mcp-handlers");
const AUTHORING = () => import("@/lib/workbooks/mcp-authoring-handlers");

export const workbooksPack: ToolPack = {
  packId: "workbooks",
  definitions,
  handlers: {
    workbook_list_tables: (params, userId) => HANDLERS().then((m) => m.workbookListTablesTool(params, userId)),
    workbook_get_schema: (params, userId) => HANDLERS().then((m) => m.workbookGetSchemaTool(params, userId)),
    workbook_query_rows: (params, userId) => HANDLERS().then((m) => m.workbookQueryRowsTool(params, userId)),
    workbook_create_row: (params, userId) => HANDLERS().then((m) => m.workbookCreateRowTool(params, userId)),
    workbook_update_cells: (params, userId) => HANDLERS().then((m) => m.workbookUpdateCellsTool(params, userId)),
    workbook_create: (params, userId) => AUTHORING().then((m) => m.workbookCreateTool(params, userId)),
    workbook_create_table: (params, userId) => AUTHORING().then((m) => m.workbookCreateTableTool(params, userId)),
    workbook_add_column: (params, userId) => AUTHORING().then((m) => m.workbookAddColumnTool(params, userId)),
    workbook_create_view: (params, userId) => AUTHORING().then((m) => m.workbookCreateViewTool(params, userId)),
  },
  grants: WORKBOOK_TOOL_GRANTS,
};
