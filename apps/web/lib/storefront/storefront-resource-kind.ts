/**
 * Shared classification seam for storefront resources that are still stored
 * in ServiceProvider. The restaurant capacity projection and spatial entity
 * resolver must agree until the structured resource-pool model replaces this
 * compatibility heuristic.
 */

const TABLE_NAME_RX =
  /\b(table|booth|window\s*seat|bar\s*seat|counter\s*seat|patio|terrace|banquette)\b/i;
const IDENTIFIER_TABLE_RX =
  /^\s*t(?:able)?\s*[-#]?\s*\d{1,3}\s*$/i;

export type StorefrontResourceKind = "table" | "staff";

export function classifyStorefrontResource(row: {
  name: string;
  resourceKind?: StorefrontResourceKind | null;
}): StorefrontResourceKind {
  if (row.resourceKind === "table" || row.resourceKind === "staff") {
    return row.resourceKind;
  }
  const name = row.name ?? "";
  if (IDENTIFIER_TABLE_RX.test(name)) return "table";
  if (TABLE_NAME_RX.test(name)) return "table";
  return "staff";
}
