// Universal Grid & Workbooks — undo/redo stack transitions (EP-GRID-WORKBOOKS, Phase 2)
//
// Pure list transitions for multi-step cell-edit undo/redo, kept out of the
// component so the invariants are unit-testable. The component owns the async
// replay (persisting the inverse edit through the validated dispatch) and only
// commits a transition here once the persist succeeds.

import type { CellValue } from "@/lib/workbooks/types";

/** One undoable cell edit. */
export interface CellEdit {
  rowId: string;
  columnId: string;
  prevValue: CellValue;
  nextValue: CellValue;
}

export interface GridHistory {
  undo: CellEdit[];
  redo: CellEdit[];
}

export const EMPTY_HISTORY: GridHistory = { undo: [], redo: [] };

/** Record a fresh edit: push onto undo and clear the redo branch. */
export function recordEdit(h: GridHistory, edit: CellEdit): GridHistory {
  return { undo: [...h.undo, edit], redo: [] };
}

export function peekUndo(h: GridHistory): CellEdit | undefined {
  return h.undo[h.undo.length - 1];
}

export function peekRedo(h: GridHistory): CellEdit | undefined {
  return h.redo[h.redo.length - 1];
}

/** After a successful undo of the top entry: move it from undo → redo. */
export function commitUndo(h: GridHistory): GridHistory {
  const entry = peekUndo(h);
  if (!entry) return h;
  return { undo: h.undo.slice(0, -1), redo: [...h.redo, entry] };
}

/** After a successful redo of the top entry: move it from redo → undo. */
export function commitRedo(h: GridHistory): GridHistory {
  const entry = peekRedo(h);
  if (!entry) return h;
  return { undo: [...h.undo, entry], redo: h.redo.slice(0, -1) };
}
