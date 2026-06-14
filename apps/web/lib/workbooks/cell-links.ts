// Universal Grid & Workbooks — link cell helpers (EP-GRID-WORKBOOKS)
//
// A `link` column points a cell at many target records, stored as rows in
// WorkbookCellLink (not in WorkbookCell scalar columns). This module is the pure,
// DB-free validation/normalization shared by the write path; Prisma persistence
// lives in the adapter. Cardinality "one" caps a cell at a single link; the
// cross-row 1-M/1-1 uniqueness (a target linked by at most one row) is a write-path
// + DB concern handled in a later slice.

import type { CellValue, ReferenceValue, LinkConfig } from "./types";

/** A value is a single reference object ({referenceId, referenceType}). */
export function isReferenceValue(v: unknown): v is ReferenceValue {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "referenceId" in v &&
    typeof (v as ReferenceValue).referenceId === "string"
  );
}

/**
 * Validate + normalize a link cell value to a clean, de-duplicated
 * ReferenceValue[] for a `link` column. Throws (fail-closed) on a bad shape, a
 * wrong target type, or a cardinality violation. `null`/empty → no links.
 */
export function validateLinkValue(
  value: CellValue,
  config: LinkConfig | undefined,
): ReferenceValue[] {
  if (!config) throw new Error("Link column is missing its target configuration");
  if (value === null || value === undefined || value === "") return [];
  if (!Array.isArray(value)) throw new Error("A link value must be a list of records");

  const links: ReferenceValue[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isReferenceValue(item)) {
      throw new Error("Each link must be a {referenceId, referenceType}");
    }
    const referenceType = item.referenceType ?? config.referenceType;
    if (referenceType !== config.referenceType) {
      throw new Error(`This column links to ${config.referenceType}`);
    }
    if (seen.has(item.referenceId)) continue; // dedup within the cell
    seen.add(item.referenceId);
    links.push({ referenceId: item.referenceId, referenceType });
  }
  if (config.cardinality === "one" && links.length > 1) {
    throw new Error("This column allows only one linked record");
  }
  return links;
}
