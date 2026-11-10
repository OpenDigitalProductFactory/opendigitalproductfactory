import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

import {
  IT4IT_REFERENCE_JSON_PATH,
  loadIt4itReferenceRows,
  parseIt4itReferenceDocument,
} from "./it4it-reference-data.js";

// BI-B470264D: the EA reference-model seed runs in portal-init on every install.
// It reads committed JSON, never the LFS-tracked workbook, and nothing under
// packages/db/src may pull the spreadsheet parser back onto that path.

const SRC_ROOT = __dirname;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|mts|cts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("IT4IT reference data (committed JSON)", () => {
  it("loads non-empty functional, value-stream and participation rows from the committed JSON", () => {
    const rows = loadIt4itReferenceRows();
    expect(rows.functionalRows.length).toBeGreaterThan(0);
    expect(rows.valueStreamRows.length).toBeGreaterThan(0);
    expect(rows.participationRows.length).toBeGreaterThan(0);
  });

  it("records the workbook it was generated from", () => {
    const doc = parseIt4itReferenceDocument(readFileSync(IT4IT_REFERENCE_JSON_PATH, "utf8"));
    expect(doc.source.path).toBe("docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx");
    expect(doc.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a document that would seed nothing (BI-98D19DF2 shape, caught before any write)", () => {
    const empty = JSON.stringify({
      formatVersion: 1,
      source: { path: "x", sha256: "0".repeat(64), size: 1 },
      functionalRows: [],
      valueStreamRows: [],
      participationRows: [],
    });
    expect(() => parseIt4itReferenceDocument(empty)).toThrow(/functionalRows is empty/);
  });

  it("refuses an unknown format version", () => {
    expect(() => parseIt4itReferenceDocument(JSON.stringify({ formatVersion: 2 }))).toThrow(/formatVersion/);
  });

  it("keeps read-excel-file off every packages/db/src import path (AC-2)", () => {
    const offenders = listSourceFiles(SRC_ROOT)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /from\s+["']read-excel-file|require\(\s*["']read-excel-file|excel-sheet-reader/.test(
          text.replace(/\/\/.*$/gm, ""),
        );
      })
      .map((file) => relative(SRC_ROOT, file))
      // This guard names the patterns it forbids.
      .filter((file) => file !== "it4it-reference-data.test.ts");
    expect(offenders).toEqual([]);
  });
});
