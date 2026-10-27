// Workbook tool grants, extracted from agent-grants.ts and spread into
// TOOL_TO_GRANTS (the BANKING_TOOL_GRANTS pattern). workbooks-pack.ts uses this
// object as its `grants`, so the gating map and the pack cannot drift;
// apps/web/scripts/audit-coworker-tool-grants.ts reads this map.
//
// The split mirrors the UI's capabilities: view_workbooks reads (workbook_read),
// manage_workbooks writes (workbook_write). Schema authoring (BI-FE8DF004:
// create a workbook, table, typed column or view) is a workbook write, exactly
// as the UI treats it; the per-workbook WorkbookShare role is still enforced
// in the service on every call.

export const WORKBOOK_TOOL_GRANTS = {
  workbook_list_tables: ["workbook_read"],
  workbook_get_schema: ["workbook_read"],
  workbook_query_rows: ["workbook_read"],
  workbook_create_row: ["workbook_write"],
  workbook_update_cells: ["workbook_write"],
  workbook_create: ["workbook_write"],
  workbook_create_table: ["workbook_write"],
  workbook_add_column: ["workbook_write"],
  workbook_create_view: ["workbook_write"],
} satisfies Record<string, string[]>;
