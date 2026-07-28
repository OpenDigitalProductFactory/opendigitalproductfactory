import { describe, expect, it } from "vitest";
import {
  committed,
  dirtyFieldIds,
  dirtyValues,
  discarded,
  formValuesEqual,
  initFormState,
  isFormDirty,
  rebaselined,
  withFieldEdit,
} from "./form-state";

describe("formValuesEqual", () => {
  it("treats null and undefined as the same empty value", () => {
    expect(formValuesEqual(null, undefined)).toBe(true);
    expect(formValuesEqual(undefined, null)).toBe(true);
    expect(formValuesEqual(null, "")).toBe(false);
  });

  it("compares primitives with Object.is and arrays structurally", () => {
    expect(formValuesEqual("a", "a")).toBe(true);
    expect(formValuesEqual(1, 2)).toBe(false);
    expect(formValuesEqual(["x", "y"], ["x", "y"])).toBe(true);
    expect(formValuesEqual(["x"], ["y"])).toBe(false);
    expect(formValuesEqual({ referenceId: "r1" }, { referenceId: "r1" })).toBe(true);
  });
});

describe("form draft lifecycle", () => {
  const base = { title: "Original", priority: 1, done: false };

  it("starts clean", () => {
    const s = initFormState(base);
    expect(isFormDirty(s)).toBe(false);
    expect(dirtyFieldIds(s)).toEqual([]);
  });

  it("tracks edits as dirty and reverting an edit clears it", () => {
    let s = withFieldEdit(initFormState(base), "title", "Changed");
    expect(dirtyFieldIds(s)).toEqual(["title"]);
    s = withFieldEdit(s, "title", "Original");
    expect(isFormDirty(s)).toBe(false);
  });

  it("dirtyValues returns only the changed subset, undefined normalized to null", () => {
    let s = withFieldEdit(initFormState(base), "priority", 2);
    s = withFieldEdit(s, "done", undefined);
    expect(dirtyValues(s)).toEqual({ priority: 2, done: null });
  });

  it("discard snaps the draft back to the baseline", () => {
    const s = discarded(withFieldEdit(initFormState(base), "title", "Changed"));
    expect(isFormDirty(s)).toBe(false);
    expect(s.draft.title).toBe("Original");
  });

  it("commit makes the draft the new baseline", () => {
    const s = committed(withFieldEdit(initFormState(base), "title", "Changed"));
    expect(isFormDirty(s)).toBe(false);
    expect(s.baseline.title).toBe("Changed");
  });

  it("rebaseline keeps unsaved edits but adopts outside changes elsewhere", () => {
    const s = withFieldEdit(initFormState(base), "title", "My unsaved edit");
    const r = rebaselined(s, { title: "Server title", priority: 9, done: true });
    expect(r.draft.title).toBe("My unsaved edit"); // typing preserved
    expect(r.draft.priority).toBe(9); // outside change adopted
    expect(r.baseline.title).toBe("Server title");
    expect(dirtyFieldIds(r)).toEqual(["title"]);
  });
});
