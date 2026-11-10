import { describe, expect, it, vi } from "vitest";
import { WORKBOOK_EXPORT_FIXTURE } from "./export-fixture";
import { exportWorkbook, isWorkbookExportFormat, parseWorkbookExportModel } from "./export-workbook";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("parseWorkbookExportModel", () => {
  it("accepts the fixture unchanged", () => {
    const parsed = parseWorkbookExportModel(JSON.parse(JSON.stringify(WORKBOOK_EXPORT_FIXTURE)));
    expect(parsed).toEqual({ ok: true, data: WORKBOOK_EXPORT_FIXTURE });
  });

  it("refuses bodies that are not a model", () => {
    for (const body of [
      null,
      [],
      { columns: [] },
      { columns: [{ name: "A", fieldType: "spaceship" }], rows: [] },
      { columns: [{ name: "A", fieldType: "text" }], rows: [["a", "b"]] },
      { columns: [{ name: "A", fieldType: "text" }], rows: [[{ nested: true }]] },
      { columns: [{ name: "A", fieldType: "text" }], rows: [], conditionalRules: [{ columnIndex: 3, operator: "eq", value: "x", color: "red" }] },
      { columns: [{ name: "A", fieldType: "text" }], rows: [], conditionalRules: [{ columnIndex: 0, operator: "regex", value: "x", color: "red" }] },
      { columns: [{ name: "A", fieldType: "text" }], rows: [], chart: { groupByColumnIndex: 5, valueColumnIndex: null } },
    ]) {
      expect(parseWorkbookExportModel(body)).toMatchObject({ ok: false, reason: "invalid-model" });
    }
  });

  it("fills defaults for an omitted sheet name, rules and chart", () => {
    const parsed = parseWorkbookExportModel({ columns: [{ name: "A", fieldType: "text" }], rows: [["x"]] });
    expect(parsed).toEqual({
      ok: true,
      data: { sheetName: "Sheet1", columns: [{ name: "A", fieldType: "text" }], rows: [["x"]], conditionalRules: [], chart: null },
    });
  });
});

describe("exportWorkbook", () => {
  it("exports the flat ODS through dpf-render's document mode and names the file after the sheet", async () => {
    const render = vi.fn(async () => ({ ok: true as const, data: [{ format: "xlsx" as const, bytes: Buffer.from("PK xlsx"), mime: XLSX }] }));
    const out = await exportWorkbook(WORKBOOK_EXPORT_FIXTURE, "xlsx", { render: render as never });
    expect(out).toEqual({ ok: true, data: { bytes: Buffer.from("PK xlsx"), mimeType: XLSX, filename: "Orders.xlsx" } });
    const call = (render.mock.calls[0] as unknown as [{ ext: string; xml: string; formats: string[] }])[0];
    expect(call.ext).toBe("fods");
    expect(call.formats).toEqual(["xlsx"]);
    expect(call.xml).toContain('office:mimetype="application/vnd.oasis.opendocument.spreadsheet"');
    expect(call.xml).toContain('office:mimetype="application/vnd.oasis.opendocument.chart"');
  });

  it("passes converter-unavailable through, so the caller can fall back, and reports a refused render as a failed export", async () => {
    const off = vi.fn(async () => ({ ok: false as const, error: "off", reason: "converter-unavailable" as const }));
    expect(await exportWorkbook(WORKBOOK_EXPORT_FIXTURE, "ods", { render: off as never })).toMatchObject({
      ok: false,
      reason: "converter-unavailable",
    });
    const refused = vi.fn(async () => ({ ok: false as const, error: "exit 2", reason: "render-failed" as const }));
    expect(await exportWorkbook(WORKBOOK_EXPORT_FIXTURE, "ods", { render: refused as never })).toMatchObject({
      ok: false,
      reason: "conversion-failed",
    });
  });

  it("knows its formats", () => {
    expect(isWorkbookExportFormat("xlsx")).toBe(true);
    expect(isWorkbookExportFormat("ods")).toBe(true);
    expect(isWorkbookExportFormat("csv")).toBe(false);
  });
});
