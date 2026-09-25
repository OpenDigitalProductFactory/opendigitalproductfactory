// Docker-gated round trip of the Workbook export (BI-4865EB4D, AC-ODC-008).
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker answers. Otherwise every
// case is reported SKIPPED, never passed.
//
// The fixture Workbook (formulas, number formats, a conditional format and one
// chart view) exports through the real engine to .xlsx and .ods. Each file is
// re-imported the way the platform imports a sheet: .xlsx through
// read-excel-file (Workbooks' sheet import), .ods through the engine to .xlsx
// first (the converter-backed ingestion route) and then the same reader. The
// values must come back unchanged, and the file must carry the formulas,
// formats, conditional format and chart-view data, not only the values.

import { spawnSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { convertDocument, createConversionLimiter } from "@/lib/documents/conversion/convert";
import { WORKBOOK_EXPORT_FIXTURE } from "./export-fixture";
import { exportWorkbook } from "./export-workbook";

const IMAGE = process.env.DPF_DOCTOOLS_TEST_IMAGE?.trim() ?? "";

function dockerHasImage(image: string): boolean {
  if (!isPinnedImageReference(image)) return false;
  try {
    // ambient-host-guard: allow the docker gate itself; a host without the image reports this suite SKIPPED
    return spawnSync("docker", ["image", "inspect", image], { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

const ready = dockerHasImage(IMAGE);
const limiter = createConversionLimiter(2);
const convert: typeof convertDocument = (request) =>
  convertDocument(request, { resolveImage: async () => ({ status: "pinned", image: IMAGE }), limiter });

/** The entries of a ZIP (stored or deflated), by name. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(dataStart, dataStart + size);
    entries.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The first sheet's rows, read with read-excel-file (the reader behind Workbooks' sheet import). */
async function readFirstSheet(xlsx: Buffer): Promise<unknown[][]> {
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const parsed: unknown = await readXlsxFile(xlsx);
  // read-excel-file@9 returns `[{ sheet, data }]`; unwrap to the row matrix.
  if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object" && "data" in parsed[0]) {
    return (parsed[0] as { data: unknown[][] }).data;
  }
  return parsed as unknown[][];
}

/** The fixture as a sheet reader returns it: header row, then values (dates as Date). */
function expectedSheet(): unknown[][] {
  const header = WORKBOOK_EXPORT_FIXTURE.columns.map((column) => column.name);
  const rows = WORKBOOK_EXPORT_FIXTURE.rows.map((row) =>
    row.map((value, index) =>
      WORKBOOK_EXPORT_FIXTURE.columns[index]!.fieldType === "date" && typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : value,
    ),
  );
  return [header, ...rows];
}

describe.skipIf(!ready)("Workbook export against the real dpf-doctools image", () => {
  it("exports .xlsx with formulas, formats, a conditional format and the chart data, and re-imports the same values", async () => {
    const out = await exportWorkbook(WORKBOOK_EXPORT_FIXTURE, "xlsx", { convert });
    if (!out.ok) throw new Error(`xlsx export failed: ${out.reason}: ${out.error}`);
    const xlsx = out.data.bytes;
    expect(out.data.filename).toBe("Orders.xlsx");

    expect(await readFirstSheet(xlsx)).toEqual(expectedSheet());

    const parts = unzip(xlsx);
    const sheet = parts.get("xl/worksheets/sheet1.xml")!.toString("utf8");
    expect(sheet).toMatch(/<f[^>]*>C2\*D2<\/f>/);
    expect(sheet).toMatch(/<f[^>]*>IF\(D2&gt;10,&quot;bulk&quot;,&quot;single&quot;\)<\/f>/);
    expect(sheet).toContain("<conditionalFormatting");
    expect(sheet).toMatch(/<formula>AND\(ISNUMBER\(\$D2\),\$D2&gt;10\)<\/formula>/);
    const styles = parts.get("xl/styles.xml")!.toString("utf8");
    expect(styles).toContain('formatCode="\\$#,##0.00"');
    expect(styles).toContain('formatCode="#,##0\\%"');
    expect(styles).toContain('formatCode="yyyy\\-mm\\-dd"');
    const workbook = parts.get("xl/workbook.xml")!.toString("utf8");
    expect(workbook).toMatch(/<sheet name="Chart data"/);
    expect(parts.get("xl/worksheets/sheet2.xml")!.toString("utf8")).toMatch(/<v>47<\/v>/);
  }, 240_000);

  it("exports .ods with the same content and re-imports the same values through the engine", async () => {
    const out = await exportWorkbook(WORKBOOK_EXPORT_FIXTURE, "ods", { convert });
    if (!out.ok) throw new Error(`ods export failed: ${out.reason}: ${out.error}`);
    const parts = unzip(out.data.bytes);
    expect(parts.get("mimetype")!.toString("utf8")).toBe("application/vnd.oasis.opendocument.spreadsheet");
    const content = parts.get("content.xml")!.toString("utf8");
    expect(content).toContain('table:formula="of:=[.C2]*[.D2]"');
    expect(content).toContain("calcext:conditional-format");
    expect(content).toContain('table:name="Chart data"');

    const reimported = await convert({ input: out.data.bytes, from: "ods", to: "xlsx" });
    if (!reimported.ok) throw new Error(`ods -> xlsx failed: ${reimported.reason}: ${reimported.error}`);
    expect(await readFirstSheet(reimported.data.bytes)).toEqual(expectedSheet());
  }, 240_000);
});
