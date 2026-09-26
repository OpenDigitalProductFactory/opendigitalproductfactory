// Docker-gated round trip of the data-only .xlsx writer (BI-D1B40D43): the
// package buildXlsx writes goes through the real dpf-doctools engine and the
// Workbooks sheet import, and comes back as the same matrix.
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// AND docker has it. Otherwise it is reported SKIPPED, never passed.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { convertDocument, createConversionLimiter } from "@/lib/documents/conversion/convert";
import type { ConvertForIngestion } from "@/lib/shared/file-parsers";
import { readSheetMatrix } from "@/lib/workbooks/sheet-import";
import { buildXlsx, type XlsxValue } from "./grid-xlsx";

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
const convert: ConvertForIngestion = (request) =>
  convertDocument(request, { resolveImage: async () => ({ status: "pinned", image: IMAGE }), limiter });

describe.skipIf(!ready)("buildXlsx round trip through the real dpf-doctools image", () => {
  it("produces a valid .xlsx that imports back to the same matrix", async () => {
    const matrix: XlsxValue[][] = [
      ["Name", "Age", "City"],
      ["Alice", 30, "London"],
      ["Bob", 25, "Paris"],
    ];
    const read = await readSheetMatrix(buildXlsx(matrix, { sheetName: "People" }), "people.xlsx", { convert });
    if (!read.ok) throw new Error(read.error);
    expect(read.data).toEqual(matrix);
  }, 240_000);

  it("preserves special characters and empty cells through the round trip", async () => {
    const read = await readSheetMatrix(buildXlsx([["Label", "Value"], ["a & b <c>", 1], ["", 2]]), "labels.xlsx", { convert });
    if (!read.ok) throw new Error(read.error);
    expect(read.data[0]).toEqual(["Label", "Value"]);
    expect(read.data[1]).toEqual(["a & b <c>", 1]);
    expect(read.data[2]![1]).toBe(2);
  }, 240_000);
});
