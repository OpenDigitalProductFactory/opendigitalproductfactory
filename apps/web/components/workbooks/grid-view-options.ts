// Universal Grid & Workbooks — table ergonomics: column visibility, frozen
// (pinned) columns, and row height (EP-GRID-WORKBOOKS, toward Smartsheet parity).
//
// The immediately-perceptible spreadsheet ergonomics best-in-class grids have and
// this one was missing: hide fields you don't need, pin the leftmost columns so
// they stay put while you scroll wide tables, and pick a row density. Pure +
// unit-testable; the Grid owns the react-data-grid wiring and persistence.

import type { ColumnDefinition } from "@/lib/workbooks/types";

/** Row-height presets (px), matching the compact/default/tall pattern users expect. */
export const ROW_HEIGHTS = {
  short: 30,
  medium: 40,
  tall: 60,
} as const;

export type RowHeight = keyof typeof ROW_HEIGHTS;

export function isRowHeight(v: unknown): v is RowHeight {
  return v === "short" || v === "medium" || v === "tall";
}

/** Pixel height for a preset; defaults to `medium` for anything unrecognized. */
export function rowHeightPx(height: RowHeight | undefined): number {
  return ROW_HEIGHTS[height ?? "medium"];
}

/**
 * Drop hidden columns. Hidden ids that no longer map to a column are simply
 * ignored (defensive against stale saved state). Never mutates the input.
 */
export function visibleColumns(
  columns: ColumnDefinition[],
  hiddenIds: readonly string[],
): ColumnDefinition[] {
  if (hiddenIds.length === 0) return columns;
  const hidden = new Set(hiddenIds);
  return columns.filter((c) => !hidden.has(c.columnId));
}

/**
 * How many of the visible columns should be frozen. react-data-grid freezes the
 * *leftmost* columns only, so this is a count, not a per-column flag — clamped to
 * [0, visibleCount] and always leaving at least one column scrollable (freezing
 * every column would defeat horizontal scroll).
 */
export function clampFrozenCount(frozenCount: number, visibleCount: number): number {
  if (!Number.isFinite(frozenCount) || frozenCount <= 0 || visibleCount <= 0) return 0;
  return Math.min(Math.floor(frozenCount), Math.max(0, visibleCount - 1));
}
