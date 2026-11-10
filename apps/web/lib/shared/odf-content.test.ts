import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readOdfContentXml, readOdfSheet, readOdfText } from "./odf-content";

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"';

const textDocument = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
const spreadsheet = (tables: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:document-content>`;

/** A ZIP with one deflated entry, the shape the engine's .odt/.ods output has. */
function zipOf(name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf8");
  const packed = deflateRawSync(data);
  const nameBytes = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, packed, central, nameBytes, end]);
}

describe("readOdfContentXml", () => {
  it("reads content.xml out of an OpenDocument package", () => {
    const xml = textDocument("<text:p>Hello</text:p>");
    expect(readOdfContentXml(zipOf("content.xml", xml))).toBe(xml);
  });

  it("throws when the bytes are not an OpenDocument package", () => {
    expect(() => readOdfContentXml(Buffer.from("not a zip"))).toThrow(/OpenDocument/);
    expect(() => readOdfContentXml(zipOf("other.xml", "<x/>"))).toThrow(/OpenDocument/);
  });
});

describe("readOdfText", () => {
  it("keeps headings in order and the paragraph text, whitespace collapsed as ODF defines", () => {
    const result = readOdfText(
      textDocument(
        '<text:sequence-decls><text:sequence-decl text:name="Table"/></text:sequence-decls>' +
          '<text:h text:outline-level="1">Rescue <text:span>operations</text:span> plan</text:h>' +
          "<text:p>Second Chance\n   fosters twelve dogs<text:s text:c=\"2\"/>this quarter.</text:p>" +
          '<text:section><text:h text:outline-level="2">Budget</text:h><text:p>Food<text:tab/>40<text:line-break/>Vets</text:p></text:section>',
      ),
    );
    expect(result.headings).toEqual(["Rescue operations plan", "Budget"]);
    expect(result.text).toBe("Rescue operations plan\n\nSecond Chance fosters twelve dogs  this quarter.\n\nBudget\n\nFood\t40\nVets");
  });

  it("counts a paragraph in a Heading 1-6 style as a heading, as Word does, even when it has no outline level", () => {
    const xml = textDocument(
      '<text:p text:style-name="P1">Quarterly Board Pack</text:p><text:p text:style-name="Heading_20_3">Plain heading</text:p>' +
        '<text:p text:style-name="P2">Body text</text:p><text:p text:style-name="Title">A title</text:p>',
    ).replace(
      "<office:body>",
      '<office:automatic-styles><style:style xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" style:name="P1" style:family="paragraph" style:parent-style-name="Heading_20_1"/>' +
        '<style:style xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" style:name="P2" style:family="paragraph" style:parent-style-name="Text_20_body"/></office:automatic-styles><office:body>',
    );
    expect(readOdfText(xml).headings).toEqual(["Quarterly Board Pack", "Plain heading"]);
  });

  it("reads lists, tables and text boxes, and leaves out comments and deleted text", () => {
    const result = readOdfText(
      textDocument(
        "<text:tracked-changes><text:changed-region><text:deletion><text:p>REMOVED</text:p></text:deletion></text:changed-region></text:tracked-changes>" +
          "<text:list><text:list-item><text:p>Hire two coordinators</text:p></text:list-item></text:list>" +
          "<table:table><table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell><text:p>Units</text:p></table:table-cell></table:table-row>" +
          "<table:table-row><table:table-cell><text:p>North</text:p></table:table-cell><table:table-cell><text:p>42</text:p></table:table-cell></table:table-row></table:table>" +
          '<text:p>See<office:annotation><text:p>PRIVATE NOTE</text:p></office:annotation> the <draw:frame><draw:text-box><text:p>Boxed text</text:p></draw:text-box></draw:frame>plan</text:p>',
      ),
    );
    expect(result.text).toContain("Hire two coordinators");
    expect(result.text).toContain("Region\tUnits\nNorth\t42");
    expect(result.text).toContain("See the plan");
    expect(result.text).toContain("Boxed text");
    expect(result.text).not.toContain("REMOVED");
    expect(result.text).not.toContain("PRIVATE NOTE");
    expect(result.headings).toEqual([]);
  });

  it("decodes XML entities once", () => {
    expect(readOdfText(textDocument("<text:p>a &amp; b &lt;c&gt; &amp;amp;</text:p>")).text).toBe("a & b <c> &amp;");
  });

  it("throws when the XML is not an OpenDocument text", () => {
    expect(() => readOdfText(spreadsheet(""))).toThrow(/OpenDocument text/);
  });
});

describe("readOdfSheet", () => {
  const cell = (attrs: string, text = "") => `<table:table-cell ${attrs}>${text ? `<text:p>${text}</text:p>` : ""}</table:table-cell>`;

  it("reads the first sheet as typed cells: text, numbers, booleans and dates", () => {
    const xml = spreadsheet(
      '<table:table table:name="Roster">' +
        `<table:table-row>${cell('office:value-type="string"', "Name")}${cell('office:value-type="string"', "Age")}${cell('office:value-type="string"', "Fostered")}${cell('office:value-type="string"', "Since")}</table:table-row>` +
        `<table:table-row>${cell('office:value-type="string"', "Biscuit")}${cell('office:value-type="float" office:value="3"', "3")}${cell('office:value-type="boolean" office:boolean-value="true"', "TRUE")}${cell('office:value-type="date" office:date-value="2026-09-25"', "09/25/26")}</table:table-row>` +
        `<table:table-row>${cell('office:value-type="string"', "Mochi")}${cell('office:value-type="percentage" office:value="0.5"', "50%")}${cell('office:value-type="boolean" office:boolean-value="false"', "FALSE")}${cell('office:value-type="date" office:date-value="2026-01-02T13:45:00"', "01/02/26 13:45")}</table:table-row>` +
        "</table:table>" +
        `<table:table table:name="Other"><table:table-row>${cell('office:value-type="string"', "IGNORED")}</table:table-row></table:table>`,
    );
    const { rows, rowCount } = readOdfSheet(xml);
    expect(rowCount).toBe(3);
    expect(rows).toEqual([
      ["Name", "Age", "Fostered", "Since"],
      ["Biscuit", 3, true, new Date("2026-09-25T00:00:00Z")],
      ["Mochi", 0.5, false, new Date("2026-01-02T13:45:00Z")],
    ]);
  });

  it("expands repeated cells and rows but drops the trailing empty ones LibreOffice writes", () => {
    const xml = spreadsheet(
      "<table:table>" +
        '<table:table-column table:number-columns-repeated="16384"/>' +
        `<table:table-row>${cell('office:value-type="string"', "A")}<table:table-cell table:number-columns-repeated="2"/>${cell('office:value-type="string"', "D")}<table:table-cell table:number-columns-repeated="16380"/></table:table-row>` +
        '<table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>' +
        `<table:table-row table:number-rows-repeated="2">${cell('office:value-type="float" office:value="7" table:number-columns-repeated="2"', "7")}</table:table-row>` +
        '<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>' +
        "</table:table>",
    );
    const { rows, rowCount } = readOdfSheet(xml);
    expect(rows).toEqual([["A", null, null, "D"], [], [], [7, 7], [7, 7]]);
    expect(rowCount).toBe(5);
  });

  it("reads rows inside header-row and row-group wrappers, and covered (merged) cells as blanks", () => {
    const xml = spreadsheet(
      "<table:table>" +
        `<table:table-header-rows><table:table-row>${cell('office:value-type="string"', "Head")}</table:table-row></table:table-header-rows>` +
        `<table:table-row-group><table:table-row>${cell('office:value-type="string" table:number-columns-spanned="2"', "Merged")}<table:covered-table-cell/>${cell('office:value-type="string"', "C")}</table:table-row></table:table-row-group>` +
        "</table:table>",
    );
    expect(readOdfSheet(xml).rows).toEqual([["Head"], ["Merged", null, "C"]]);
  });

  it("keeps at most maxRows rows and maxColumns cells but counts every row", () => {
    const row = (value: string) => `<table:table-row>${cell('office:value-type="string"', value)}${cell('office:value-type="string"', "x")}</table:table-row>`;
    const xml = spreadsheet(`<table:table>${["h", "1", "2", "3"].map(row).join("")}</table:table>`);
    const { rows, rowCount } = readOdfSheet(xml, { maxRows: 2, maxColumns: 1 });
    expect(rows).toEqual([["h"], ["1"]]);
    expect(rowCount).toBe(4);
  });

  it("returns no rows for an empty sheet and throws for a document that is not a spreadsheet", () => {
    expect(readOdfSheet(spreadsheet("<table:table/>"))).toEqual({ rows: [], rowCount: 0 });
    expect(() => readOdfSheet(textDocument("<text:p>x</text:p>"))).toThrow(/OpenDocument spreadsheet/);
  });
});
