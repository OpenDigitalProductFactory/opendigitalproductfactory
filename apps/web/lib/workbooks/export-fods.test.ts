import { describe, expect, it } from "vitest";
import { buildFlatOds, chartBars, sanitizeSheetName, type WorkbookExportModel } from "./export-fods";
import { WORKBOOK_EXPORT_FIXTURE } from "./export-fixture";

const xml = buildFlatOds(WORKBOOK_EXPORT_FIXTURE);

/** A sheet's own rows; a chart's shapes (and its cached local table) are not rows of the sheet. */
function rowsOf(source: string, sheet: string): string[] {
  const doc = source.replace(/<table:shapes>.*?<\/table:shapes>/gs, "");
  const start = doc.indexOf(`<table:table table:name="${sheet}">`);
  const end = doc.indexOf("</table:table>", start);
  return doc.slice(start, end).split("<table:table-row>").slice(1);
}

describe("buildFlatOds", () => {
  it("is a flat ODS spreadsheet document, deterministic for the same model", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('office:mimetype="application/vnd.oasis.opendocument.spreadsheet"');
    expect(buildFlatOds(WORKBOOK_EXPORT_FIXTURE)).toBe(xml);
  });

  it("writes a bold header row and typed cells", () => {
    const rows = rowsOf(xml, "Orders");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('table:style-name="ce-head" office:value-type="string"><text:p>Item</text:p>');
    expect(rows[1]).toContain('office:value-type="float" office:value="2.5"');
    expect(rows[1]).toContain('office:value-type="boolean" office:boolean-value="true"');
    expect(rows[1]).toContain('office:value-type="date" office:date-value="2026-09-01"');
    expect(rows[3]).toContain("<text:p>Gizmo &amp; Co &lt;b&gt;</text:p>");
  });

  it("carries column number formats: currency, precision, percent as a literal sign", () => {
    expect(xml).toContain('<number:number-style style:name="N-cur-24-2"><number:text>$</number:text><number:number number:decimal-places="2"');
    expect(xml).toContain('<number:number-style style:name="N-num-0"><number:number number:decimal-places="0"');
    expect(xml).toMatch(/<number:number-style style:name="N-pct-0"><number:number [^>]*\/><number:text>%<\/number:text>/);
    expect(rowsOf(xml, "Orders")[1]).toContain('table:style-name="ce-N-cur-24-2" office:value-type="float" office:value="2.5"');
  });

  it("writes formula columns as formulas with the computed value cached", () => {
    const rows = rowsOf(xml, "Orders");
    expect(rows[1]).toContain('table:formula="of:=[.C2]*[.D2]" office:value-type="float" office:value="30"');
    expect(rows[2]).toContain('table:formula="of:=[.C3]*[.D3]"');
    expect(rows[1]).toContain('table:formula="of:=IF([.D2]&gt;10;&quot;bulk&quot;;&quot;single&quot;)" office:value-type="string"><text:p>bulk</text:p>');
  });

  it("writes an untranslatable formula as its value alone", () => {
    const model: WorkbookExportModel = {
      ...WORKBOOK_EXPORT_FIXTURE,
      columns: [{ name: "Done", fieldType: "formula", formula: 'COUNTIF([Status], "done")' }],
      rows: [[3]],
      conditionalRules: [],
      chart: null,
    };
    const out = buildFlatOds(model);
    expect(out).not.toContain("table:formula");
    expect(out).toContain('office:value="3"');
  });

  it("turns grid rules into row-level conditional formats over the data rows", () => {
    expect(xml).toContain('<style:style style:name="dpf-cf-green" style:family="table-cell" style:parent-style-name="Default"><style:table-cell-properties fo:background-color=');
    expect(xml).toContain(
      `<calcext:conditional-format calcext:target-range-address="&apos;Orders&apos;.A2:&apos;Orders&apos;.I5"><calcext:condition calcext:apply-style-name="dpf-cf-green" calcext:value="formula-is(AND(ISNUMBER($D2);$D2&gt;10))" calcext:base-cell-address="&apos;Orders&apos;.A2"/>`,
    );
  });

  it("skips rules that can never match", () => {
    const out = buildFlatOds({
      ...WORKBOOK_EXPORT_FIXTURE,
      conditionalRules: [
        { columnIndex: 3, operator: "gt", value: "lots", color: "red" },
        { columnIndex: 0, operator: "contains", value: " ", color: "red" },
        { columnIndex: 99, operator: "empty", value: "", color: "red" },
      ],
    });
    expect(out).not.toContain("calcext:conditional-formats");
  });

  it("adds the chart view's bars as a Chart data sheet", () => {
    expect(chartBars(WORKBOOK_EXPORT_FIXTURE, WORKBOOK_EXPORT_FIXTURE.chart!)).toEqual([
      { label: "North", value: 47 },
      { label: "East", value: 20 },
      { label: "South", value: 30 },
    ]);
    const rows = rowsOf(xml, "Chart data");
    expect(rows[0]).toContain("<text:p>Region</text:p>");
    expect(rows[0]).toContain("<text:p>Sum of Total</text:p>");
    expect(rows[1]).toContain('<text:p>North</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="47"');
    expect(rows).toHaveLength(4);
    // The bar chart itself: one inline chart sub-document over the sheet's cells (BI-BFF142A1).
    expect(xml.match(/<draw:object[\s>]/g)).toHaveLength(1);
    expect(xml).toContain('office:mimetype="application/vnd.oasis.opendocument.chart"');
    expect(xml).toContain('chart:values-cell-range-address="&apos;Chart data&apos;.B2:&apos;Chart data&apos;.B4"');
    expect(xml).toContain('<chart:categories table:cell-range-address="&apos;Chart data&apos;.A2:&apos;Chart data&apos;.A4"/>');
    expect(xml).toContain("<text:p>Sum of Total by Region</text:p>");
    // Nothing dpf-render's document screen refuses: no scripts, events, DDE or links.
    expect(xml).not.toMatch(/office:script|event-listener|dde-|xlink:href/);
  });

  it("counts rows per group when the chart has no value column, and omits the chart sheet when there are no rows", () => {
    const counted = chartBars(WORKBOOK_EXPORT_FIXTURE, { groupByColumnIndex: 1, valueColumnIndex: null });
    expect(counted).toEqual([
      { label: "North", value: 2 },
      { label: "East", value: 1 },
      { label: "South", value: 1 },
    ]);
    expect(buildFlatOds({ ...WORKBOOK_EXPORT_FIXTURE, rows: [] })).not.toContain("Chart data");
  });
});

describe("sanitizeSheetName", () => {
  it("drops forbidden characters and caps the length", () => {
    expect(sanitizeSheetName("a/b:c*d?[e]'f")).toBe("a b c d e f");
    expect(sanitizeSheetName("x".repeat(40))).toHaveLength(31);
    expect(sanitizeSheetName("  ")).toBe("Sheet1");
  });
});
