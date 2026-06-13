import { describe, it, expect } from "vitest";
import {
  EMPTY_HISTORY,
  recordEdit,
  peekUndo,
  peekRedo,
  commitUndo,
  commitRedo,
  type CellEdit,
} from "./grid-history";

const edit = (rowId: string, prev: string, next: string): CellEdit => ({
  rowId,
  columnId: "c1",
  prevValue: prev,
  nextValue: next,
});

describe("grid-history", () => {
  it("records an edit onto undo and clears the redo branch", () => {
    let h = recordEdit(EMPTY_HISTORY, edit("r1", "a", "b"));
    h = commitUndo(h); // r1 now on redo
    expect(h.redo).toHaveLength(1);
    // a new edit must clear the redo branch (no longer reachable)
    h = recordEdit(h, edit("r2", "x", "y"));
    expect(h.redo).toHaveLength(0);
    expect(h.undo).toHaveLength(1);
  });

  it("peeks the most recent undo/redo entry", () => {
    const h = recordEdit(recordEdit(EMPTY_HISTORY, edit("r1", "a", "b")), edit("r2", "c", "d"));
    expect(peekUndo(h)?.rowId).toBe("r2");
    expect(peekRedo(h)).toBeUndefined();
  });

  it("moves entries undo → redo on commitUndo and back on commitRedo", () => {
    let h = recordEdit(EMPTY_HISTORY, edit("r1", "a", "b"));
    h = commitUndo(h);
    expect(h.undo).toHaveLength(0);
    expect(peekRedo(h)?.rowId).toBe("r1");
    h = commitRedo(h);
    expect(peekUndo(h)?.rowId).toBe("r1");
    expect(h.redo).toHaveLength(0);
  });

  it("round-trips a multi-edit stack in LIFO order", () => {
    let h = EMPTY_HISTORY;
    h = recordEdit(h, edit("r1", "1", "2"));
    h = recordEdit(h, edit("r2", "3", "4"));
    expect(peekUndo(h)?.rowId).toBe("r2");
    h = commitUndo(h); // undo r2
    expect(peekUndo(h)?.rowId).toBe("r1");
    expect(peekRedo(h)?.rowId).toBe("r2");
    h = commitUndo(h); // undo r1
    expect(h.undo).toHaveLength(0);
    expect(h.redo.map((e) => e.rowId)).toEqual(["r2", "r1"]);
  });

  it("is a no-op when committing past the end of a stack", () => {
    expect(commitUndo(EMPTY_HISTORY)).toBe(EMPTY_HISTORY);
    expect(commitRedo(EMPTY_HISTORY)).toBe(EMPTY_HISTORY);
  });
});
