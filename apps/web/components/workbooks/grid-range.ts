// Universal Grid & Workbooks — cell range selection (EP-GRID-WORKBOOKS,
// visual-refinement spec S3: Excel-grade cell interactions).
//
// react-data-grid v7 has no built-in rectangular selection, so the grid tracks a
// range as an anchor + focus cell (row/col indices into the *displayed* order) and
// this module is the pure geometry + clipboard serialization. TSV in/out matches
// Excel's clipboard format (tab between columns, newline between rows), so copy
// pastes into Excel and an Excel copy pastes back. All pure + unit-testable; the
// Grid owns the react-data-grid events, the highlight class, and persistence.

/** A selection anchored at one cell, extended to a focus cell (Excel semantics). */
export interface CellRange {
  anchorRow: number;
  anchorCol: number;
  focusRow: number;
  focusCol: number;
}

/** Inclusive bounding rectangle of a range, normalized so top<=bottom, left<=right. */
export interface RangeRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function rangeRect(r: CellRange): RangeRect {
  return {
    top: Math.min(r.anchorRow, r.focusRow),
    bottom: Math.max(r.anchorRow, r.focusRow),
    left: Math.min(r.anchorCol, r.focusCol),
    right: Math.max(r.anchorCol, r.focusCol),
  };
}

/** A single-cell range at (row, col). */
export function singleCell(row: number, col: number): CellRange {
  return { anchorRow: row, anchorCol: col, focusRow: row, focusCol: col };
}

/** True if (row, col) is inside the range's rectangle. */
export function rangeContains(r: CellRange, row: number, col: number): boolean {
  const rect = rangeRect(r);
  return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
}

/** True if the range covers more than one cell. */
export function isMultiCell(r: CellRange): boolean {
  return r.anchorRow !== r.focusRow || r.anchorCol !== r.focusCol;
}

/** Clamp a cell coordinate into [0, maxRow] × [0, maxCol]. */
export function clampCell(
  row: number,
  col: number,
  maxRow: number,
  maxCol: number,
): { row: number; col: number } {
  return {
    row: Math.max(0, Math.min(row, maxRow)),
    col: Math.max(0, Math.min(col, maxCol)),
  };
}

/**
 * Move the focus cell by (dRow, dCol), clamped to the grid — Shift+Arrow extends
 * the range (anchor unchanged), plain Arrow collapses it to the moved cell.
 */
export function extendFocus(
  r: CellRange,
  dRow: number,
  dCol: number,
  maxRow: number,
  maxCol: number,
): CellRange {
  const { row, col } = clampCell(r.focusRow + dRow, r.focusCol + dCol, maxRow, maxCol);
  return { ...r, focusRow: row, focusCol: col };
}

/** Serialize the range to Excel-style TSV via a (row,col)->text accessor. */
export function rangeToTsv(
  rect: RangeRect,
  getCell: (row: number, col: number) => string,
): string {
  const lines: string[] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const cells: string[] = [];
    for (let c = rect.left; c <= rect.right; c++) cells.push(getCell(r, c));
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Parse clipboard TSV into a 2-D grid of strings (trailing newline ignored). */
export function parseTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (normalized === "") return [[""]];
  return normalized.split("\n").map((line) => line.split("\t"));
}

/**
 * The write-set for pasting a clipboard block at an origin cell. A single
 * clipboard cell fills the whole target rect (Excel behavior); otherwise the
 * block is laid out from the origin, clipped to the grid bounds. Returns absolute
 * (row, col, value) writes for the caller to persist.
 */
export function pasteWrites(
  block: string[][],
  originRow: number,
  originCol: number,
  targetRect: RangeRect,
  maxRow: number,
  maxCol: number,
): { row: number; col: number; value: string }[] {
  const writes: { row: number; col: number; value: string }[] = [];
  const blockRows = block.length;
  const blockCols = block[0]?.length ?? 0;
  if (blockRows === 0 || blockCols === 0) return writes;

  // A 1×1 clipboard fills the entire current selection rectangle.
  if (blockRows === 1 && blockCols === 1) {
    const v = block[0]![0]!;
    for (let r = targetRect.top; r <= Math.min(targetRect.bottom, maxRow); r++) {
      for (let c = targetRect.left; c <= Math.min(targetRect.right, maxCol); c++) {
        writes.push({ row: r, col: c, value: v });
      }
    }
    return writes;
  }

  // Otherwise lay the block out from the origin, clipped to the grid.
  for (let br = 0; br < blockRows; br++) {
    const row = originRow + br;
    if (row > maxRow) break;
    const line = block[br]!;
    for (let bc = 0; bc < line.length; bc++) {
      const col = originCol + bc;
      if (col > maxCol) break;
      writes.push({ row, col, value: line[bc]! });
    }
  }
  return writes;
}

/** Excel Ctrl+D: copy each column's top-row value down over the rest of the rect. */
export function fillDownWrites(
  rect: RangeRect,
  getCell: (row: number, col: number) => string,
): { row: number; col: number; value: string }[] {
  const writes: { row: number; col: number; value: string }[] = [];
  for (let c = rect.left; c <= rect.right; c++) {
    const v = getCell(rect.top, c);
    for (let r = rect.top + 1; r <= rect.bottom; r++) writes.push({ row: r, col: c, value: v });
  }
  return writes;
}

/** Excel Ctrl+R: copy each row's left-column value across the rest of the rect. */
export function fillRightWrites(
  rect: RangeRect,
  getCell: (row: number, col: number) => string,
): { row: number; col: number; value: string }[] {
  const writes: { row: number; col: number; value: string }[] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const v = getCell(r, rect.left);
    for (let c = rect.left + 1; c <= rect.right; c++) writes.push({ row: r, col: c, value: v });
  }
  return writes;
}
