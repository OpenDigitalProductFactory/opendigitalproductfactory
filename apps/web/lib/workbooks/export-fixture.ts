// The Workbook export fixture (BI-4865EB4D): formulas, number formats, a
// conditional format and one chart view (exported as its data sheet). Shared by the unit test of the flat
// ODS writer and the docker-gated round trip through the real engine.
import type { WorkbookExportModel } from "./export-fods";

export const WORKBOOK_EXPORT_FIXTURE: WorkbookExportModel = {
  sheetName: "Orders",
  columns: [
    { name: "Item", fieldType: "text" },
    { name: "Region", fieldType: "select" },
    { name: "Price", fieldType: "currency", currencySymbol: "$", precision: 2 },
    { name: "Qty", fieldType: "number", precision: 0 },
    { name: "Total", fieldType: "formula", formula: "[Price] * [Qty]" },
    { name: "Discount", fieldType: "percent" },
    { name: "Shipped", fieldType: "checkbox" },
    { name: "Ordered", fieldType: "date" },
    { name: "Tier", fieldType: "formula", formula: 'IF([Qty] > 10, "bulk", "single")' },
  ],
  rows: [
    ["Widget", "North", 2.5, 12, 30, 10, true, "2026-09-01", "bulk"],
    ["Gadget", "South", 10, 3, 30, 0, false, "2026-09-02", "single"],
    ["Gizmo & Co <b>", "North", 4.25, 4, 17, 5, true, "2026-09-03", "single"],
    ["Doohickey", "East", 1, 20, 20, 15, false, "2026-09-04", "bulk"],
  ],
  conditionalRules: [{ columnIndex: 3, operator: "gt", value: "10", color: "green" }],
  chart: { groupByColumnIndex: 1, valueColumnIndex: 4 },
};
