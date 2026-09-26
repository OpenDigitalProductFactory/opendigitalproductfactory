import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { readWorkbook, readWorkbookBytes, requireSheetData } from "./excel-sheet-reader.js";

function buildWorkbookWithEmptyInlineStringCell(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Name</t></is></c>
      <c r="B1" t="inlineStr"><is><t>Notes</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Example</t></is></c>
      <c r="B2" s="13" t="inlineStr"></c>
    </row>
  </sheetData>
</worksheet>`),
  });
}

describe("readWorkbook", () => {
  it("treats empty inline string cells as blank cells", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dpf-xlsx-"));
    const path = join(dir, "empty-inline-string.xlsx");

    try {
      await writeFile(path, buildWorkbookWithEmptyInlineStringCell());

      const workbook = await readWorkbook(path);
      const data = requireSheetData(workbook, "Data");

      expect(data).toEqual([
        ["Name", "Notes"],
        ["Example", null],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readWorkbookBytes (BI-D1B40D43: the in-house reader that replaced read-excel-file)", () => {
  it("reads every sheet by name: shared strings, numbers, booleans, sparse cells and entities", () => {
    const workbook = zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook xmlns:r="r"><sheets><sheet name="Roster &amp; notes" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      ),
      "xl/sharedStrings.xml": strToU8(
        '<sst><si><t>Name</t></si><si><r><t>Fos</t></r><r><t xml:space="preserve">tered</t></r><rPh><t>X</t></rPh></si><si><t>A &lt;b&gt; &amp;amp;</t></si></sst>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
          '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>3.5</v></c><c r="C3" t="b"><v>1</v></c><c r="D3"/></row><row r="4"/></sheetData></worksheet>',
      ),
      "xl/worksheets/sheet2.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>ok</v></c></row></sheetData></worksheet>'),
    });
    const sheets = readWorkbookBytes(workbook);
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Roster & notes", "Second"]);
    expect(requireSheetData(sheets, "Roster & notes")).toEqual([
      ["Name", null, "Fostered"],
      [null, null, null],
      ["A <b> &amp;", 3.5, true],
    ]);
    expect(requireSheetData(sheets, "Second")).toEqual([["ok"]]);
  });
});
