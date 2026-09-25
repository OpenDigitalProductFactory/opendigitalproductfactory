// Docker-gated end-to-end test of converter-backed ingestion (BI-81524041,
// AC-ODC-005), one case per family.
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker has it. Otherwise every
// case is reported SKIPPED, never passed.
//
// Each legacy/OpenDocument input is produced at test time from the committed
// flat-ODF fixtures by the image itself, as tools/doctools/smoke.sh does, so
// the repository carries no opaque office binary. The ingestion path then runs
// with the real converter: sniff → route → convert → existing parser.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { convertDocument, createConversionLimiter, type ConvertDeps } from "@/lib/documents/conversion/convert";
import type { ConverterTarget } from "@/lib/documents/conversion/formats";
import { readSheetMatrix } from "@/lib/workbooks/sheet-import";
import { parseFileContent, type ConvertForIngestion } from "./file-parsers";

const IMAGE = process.env.DPF_DOCTOOLS_TEST_IMAGE?.trim() ?? "";
const FIXTURES = resolve(__dirname, "../../../../tools/doctools/fixtures");

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
const deps: ConvertDeps = { resolveImage: async () => ({ status: "pinned", image: IMAGE }), limiter: createConversionLimiter(2) };
const convert: ConvertForIngestion = (request) => convertDocument(request, deps);

async function produce(fixture: string, from: string, to: ConverterTarget): Promise<Buffer> {
  const out = await convertDocument({ input: readFileSync(resolve(FIXTURES, fixture)), from, to }, deps);
  if (!out.ok) throw new Error(`${fixture} -> ${to} failed: ${out.reason}: ${out.error}`);
  return out.data.bytes;
}

describe.skipIf(!ready)("converter-backed ingestion against the real dpf-doctools image", () => {
  it("word family: .doc, .rtf and .odt are read through .docx", async () => {
    for (const ext of ["doc", "rtf", "odt"] as const) {
      const bytes = await produce("sample.fodt", "fodt", ext);
      const parsed = await parseFileContent(bytes, "", `plan.${ext}`, { convert });
      if (parsed?.type !== "document") throw new Error(`.${ext}: expected document, got ${JSON.stringify(parsed)}`);
      expect(parsed.fullText).toContain("DPFSENTINELWRITER");
    }
  }, 600_000);

  it("sheet family: .xls and .ods import into a Workbook matrix as .xlsx does", async () => {
    for (const ext of ["xls", "ods"] as const) {
      const bytes = await produce("sample.fods", "fods", ext);
      const sheet = await readSheetMatrix(bytes, `roster.${ext}`, { convert });
      if (!sheet.ok) throw new Error(`.${ext}: ${sheet.error}`);
      expect(sheet.data.flat().map(String)).toContain("DPFSENTINELCALC");
      const parsed = await parseFileContent(bytes, "", `roster.${ext}`, { convert });
      expect(parsed?.type).toBe("spreadsheet");
    }
  }, 600_000);

  it("slides family: .ppt, .pptx and .odp are read as slide text", async () => {
    for (const ext of ["ppt", "pptx", "odp"] as const) {
      const bytes = await produce("sample.fodp", "fodp", ext);
      const parsed = await parseFileContent(bytes, "", `deck.${ext}`, { convert });
      if (parsed?.type !== "document") throw new Error(`.${ext}: expected document, got ${JSON.stringify(parsed)}`);
      expect(parsed.fullText).toContain("DPFSENTINELIMPRESS");
    }
  }, 600_000);
});
