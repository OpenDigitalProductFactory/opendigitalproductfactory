// Incumbent spreadsheet import core (D2 P2, BI-BF12C25C).
//
// Plan: docs/superpowers/plans/2026-07-24-incumbent-application-intake.md §4 P2.
//
// Wraps the P1 intake core (createIncumbentApplication) over the rows of an
// imported sheet. This module is the PURE, injectable part — column-name
// heuristics + per-row orchestration — so it unit-tests without a live Prisma
// client. The file → matrix → rows parsing (parseDelimitedGrid / readSheet /
// inferTableFromSheet, all existing) is thin I/O in the server action.
//
// Malformed rows are reported, never fatal (spec §6 acceptance): a bad row adds
// an error entry and the import continues. Re-importing the same sheet is
// idempotent because the P1 core matches on a derived productId.

import type { PrismaClient } from "@dpf/db";
import type { CellValue } from "@/lib/workbooks/types";
import { createIncumbentApplication, type IncumbentIntakeInput } from "./intake";

// Header heuristics — first matching column wins. The P3 UI will let an operator
// correct the mapping; this is the zero-config default.
const NAME_RE = /name|application|software|tool|product|system|service/i;
const VENDOR_RE = /vendor|supplier|publisher|provider|company/i;
const COST_RE = /cost|price|spend|annual|\$|amount/i;
const SEAT_RE = /seat|user|licen/i;

function cellToString(v: CellValue): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function cellToNumber(v: CellValue): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function findKey(keys: string[], re: RegExp): string | undefined {
  return keys.find((k) => re.test(k));
}

/**
 * Map one imported sheet row to an incumbent intake input using column-name
 * heuristics. Returns null when no name column resolves to a value (the row is
 * skipped, not an error).
 */
export function mapRowToIncumbentInput(
  row: Record<string, CellValue>,
): IncumbentIntakeInput | null {
  const keys = Object.keys(row);
  const nameKey = findKey(keys, NAME_RE);
  const name = nameKey ? cellToString(row[nameKey]).trim() : "";
  if (!name) return null;

  const vendorKey = findKey(keys, VENDOR_RE);
  const costKey = findKey(keys, COST_RE);
  const seatKey = findKey(keys, SEAT_RE);

  const vendor = vendorKey ? cellToString(row[vendorKey]).trim() || undefined : undefined;
  const annualCostDeclared = costKey ? cellToNumber(row[costKey]) : undefined;
  const seatCount = seatKey ? cellToNumber(row[seatKey]) : undefined;

  return { name, vendor, annualCostDeclared, seatCount };
}

export interface IncumbentImportResult {
  /** New incumbent products created. */
  created: number;
  /** Existing incumbents matched (idempotent re-import). */
  matched: number;
  /** Rows with no resolvable name — skipped, not errors. */
  skipped: number;
  /** Per-row failures (1-indexed row number) — reported, never fatal. */
  errors: { row: number; message: string }[];
  productIds: string[];
}

/**
 * Intake every mapped row through the P1 core, collecting a per-row result.
 * `db` is the injected Prisma client (unit-testable with a mock).
 */
export async function importIncumbentRows(
  db: PrismaClient,
  rows: Record<string, CellValue>[],
): Promise<IncumbentImportResult> {
  const result: IncumbentImportResult = {
    created: 0,
    matched: 0,
    skipped: 0,
    errors: [],
    productIds: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const input = mapRowToIncumbentInput(rows[i]);
    if (!input) {
      result.skipped += 1;
      continue;
    }
    try {
      const r = await createIncumbentApplication(db, input);
      result.productIds.push(r.productId);
      if (r.matched) result.matched += 1;
      else result.created += 1;
    } catch (e) {
      result.errors.push({ row: i + 1, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}
