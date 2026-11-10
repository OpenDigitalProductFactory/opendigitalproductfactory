// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDefinition } from "@/lib/workbooks/types";
import {
  FALLBACK_NOTICE,
  ODS_UNAVAILABLE_NOTICE,
  buildWorkbookExportModel,
  exportWorkbookView,
  type GridExportView,
} from "./grid-office-export";

const col = (columnId: string, name: string, fieldType: ColumnDefinition["fieldType"], config?: ColumnDefinition["config"]): ColumnDefinition => ({
  columnId, name, fieldType, position: 0, required: false, editable: true, ...(config ? { config } : {}),
});

const view: GridExportView = {
  tableId: "orders",
  columns: [
    col("c1", "Item", "text"),
    col("c2", "Price", "currency", { currencySymbol: "€", precision: 2 }),
    col("c3", "Shipped", "checkbox"),
    col("c4", "Total", "formula", { formula: "[Price] * 2" }),
    col("c5", "Tags", "multi_select"),
  ],
  rows: [
    { rowId: "r1", c1: "Widget", c2: 2.5, c3: true, c4: 5, c5: ["a", "b"] },
    { rowId: "r2", c1: null, c2: 1, c3: false, c4: 2, c5: [] },
  ],
  cfRules: [
    { id: "x", columnId: "c2", operator: "gt", value: "2", color: "red" },
    { id: "y", columnId: "hidden", operator: "eq", value: "z", color: "blue" },
  ],
  chart: { groupByColumnId: "c1", valueColumnId: "c2" },
};

afterEach(() => vi.restoreAllMocks());

describe("buildWorkbookExportModel", () => {
  it("maps visible columns, typed cells, rules on visible columns and the chart view", () => {
    expect(buildWorkbookExportModel(view)).toEqual({
      sheetName: "orders",
      columns: [
        { name: "Item", fieldType: "text" },
        { name: "Price", fieldType: "currency", precision: 2, currencySymbol: "€" },
        { name: "Shipped", fieldType: "checkbox" },
        { name: "Total", fieldType: "formula", formula: "[Price] * 2" },
        { name: "Tags", fieldType: "multi_select" },
      ],
      rows: [
        ["Widget", 2.5, true, 5, "a b"],
        [null, 1, false, 2, ""],
      ],
      conditionalRules: [{ columnIndex: 1, operator: "gt", value: "2", color: "red" }],
      chart: { groupByColumnIndex: 0, valueColumnIndex: 1 },
    });
  });

  it("drops a chart whose group column is hidden", () => {
    expect(buildWorkbookExportModel({ ...view, chart: { groupByColumnId: "gone", valueColumnId: null } }).chart).toBeNull();
  });
});

describe("exportWorkbookView", () => {
  function stubDownload() {
    const created: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.download);
    });
    return created;
  }

  it("posts the model and downloads the engine's file", async () => {
    const downloads = stubDownload();
    const fetchImpl = vi.fn(async () => new Response(new Blob(["PK"]), { status: 200 }));
    expect(await exportWorkbookView("ods", view, fetchImpl as never)).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/workbooks/export?format=ods");
    expect(JSON.parse(String(init.body)).rows[0][0]).toBe("Widget");
    expect(downloads).toEqual(["orders.ods"]);
  });

  it("falls back to the data-only .xlsx when conversion is unavailable, and says so", async () => {
    const downloads = stubDownload();
    const fetchImpl = vi.fn(async () =>
      Response.json({ code: "SERVICE_UNAVAILABLE", message: "off", details: { reason: "converter-unavailable" } }, { status: 503 }),
    );
    expect(await exportWorkbookView("xlsx", view, fetchImpl as never)).toBe(FALLBACK_NOTICE);
    expect(downloads).toEqual(["orders.xlsx"]);
  });

  it("has no .ods fallback, and reports other failures as they are", async () => {
    const downloads = stubDownload();
    const unavailable = vi.fn(async () =>
      Response.json({ code: "SERVICE_UNAVAILABLE", message: "off", details: { reason: "converter-unavailable" } }, { status: 503 }),
    );
    expect(await exportWorkbookView("ods", view, unavailable as never)).toBe(ODS_UNAVAILABLE_NOTICE);
    const timeout = vi.fn(async () => Response.json({ code: "EXPORT_FAILED", message: "Took too long.", details: { reason: "timeout" } }, { status: 504 }));
    expect(await exportWorkbookView("xlsx", view, timeout as never)).toBe("Took too long.");
    expect(downloads).toEqual([]);
  });
});
