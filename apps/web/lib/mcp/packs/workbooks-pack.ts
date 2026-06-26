// Workbooks tool pack — BI-ARCH-TOOLPACKS.
//
// Fourth domain pack (third lazy one), and the last clean lazy domain. Handlers
// live in @/lib/workbooks/mcp-handlers and were dynamically imported per switch
// case; each handler here is a thin wrapper that lazy-imports the module only
// when the tool is called (all five take params + userId). Definitions moved
// verbatim out of the inline PLATFORM_TOOLS array; grants mirror TOOL_TO_GRANTS.

import type { ToolDefinition } from "@/lib/mcp-tools";
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
];

const HANDLERS = () => import("@/lib/workbooks/mcp-handlers");

export const workbooksPack: ToolPack = {
  packId: "workbooks",
  definitions,
  handlers: {
    workbook_list_tables: (params, userId) => HANDLERS().then((m) => m.workbookListTablesTool(params, userId)),
    workbook_get_schema: (params, userId) => HANDLERS().then((m) => m.workbookGetSchemaTool(params, userId)),
    workbook_query_rows: (params, userId) => HANDLERS().then((m) => m.workbookQueryRowsTool(params, userId)),
    workbook_create_row: (params, userId) => HANDLERS().then((m) => m.workbookCreateRowTool(params, userId)),
    workbook_update_cells: (params, userId) => HANDLERS().then((m) => m.workbookUpdateCellsTool(params, userId)),
  },
  grants: {
    workbook_list_tables: ["workbook_read"],
    workbook_get_schema: ["workbook_read"],
    workbook_query_rows: ["workbook_read"],
    workbook_create_row: ["workbook_write"],
    workbook_update_cells: ["workbook_write"],
  },
};
