// packages/db/src/it4it-reference-data.ts
//
// The IT4IT v3.0.1 reference rows the EA reference-model seed imports, read from
// committed JSON (BI-B470264D).
//
// The JSON is GENERATED at dev time from the LFS-tracked
// docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx by
// scripts/generate-it4it-reference-json.ts. The seed runs in portal-init on
// every install, before any document-conversion image exists, so it must not
// parse a spreadsheet, and it must not depend on LFS bytes reaching the image
// (BI-FEE26C36). scripts/lib/it4it-reference-document.test.ts fails when the
// workbook changes without the JSON being regenerated.

import { readFileSync } from "fs";
import { join } from "path";

import type {
  FunctionalCriteriaRow,
  ParticipationMatrixRow,
  ValueStreamActivityRow,
} from "./reference-model-types.js";

// __dirname is packages/db/src at runtime (tsx); data/ is its sibling.
export const IT4IT_REFERENCE_JSON_PATH = join(__dirname, "..", "data", "it4it_functional_criteria_taxonomy.json");

export const IT4IT_REFERENCE_FORMAT_VERSION = 1;

export interface It4itReferenceRows {
  functionalRows: FunctionalCriteriaRow[];
  valueStreamRows: ValueStreamActivityRow[];
  participationRows: ParticipationMatrixRow[];
}

export interface It4itReferenceDocument extends It4itReferenceRows {
  $comment?: string;
  formatVersion: number;
  /** The workbook the rows were generated from; sha256 equals its Git LFS oid. */
  source: { path: string; sha256: string; size: number };
}

const ROW_KEYS = ["functionalRows", "valueStreamRows", "participationRows"] as const;

/** Parse and shape-check the committed document. Throws rather than seed nothing. */
export function parseIt4itReferenceDocument(text: string): It4itReferenceDocument {
  const doc = JSON.parse(text) as Partial<It4itReferenceDocument>;
  if (doc.formatVersion !== IT4IT_REFERENCE_FORMAT_VERSION) {
    throw new Error(
      `IT4IT reference JSON has formatVersion ${String(doc.formatVersion)}; expected ${IT4IT_REFERENCE_FORMAT_VERSION}.`,
    );
  }
  if (!doc.source || typeof doc.source.sha256 !== "string" || typeof doc.source.path !== "string") {
    throw new Error("IT4IT reference JSON is missing its source record.");
  }
  for (const key of ROW_KEYS) {
    const rows = doc[key];
    if (!Array.isArray(rows)) throw new Error(`IT4IT reference JSON: ${key} is not an array.`);
    if (rows.length === 0) throw new Error(`IT4IT reference JSON: ${key} is empty.`);
  }
  return doc as It4itReferenceDocument;
}

export function loadIt4itReferenceRows(path: string = IT4IT_REFERENCE_JSON_PATH): It4itReferenceRows {
  const { functionalRows, valueStreamRows, participationRows } = parseIt4itReferenceDocument(
    readFileSync(path, "utf8"),
  );
  return { functionalRows, valueStreamRows, participationRows };
}
