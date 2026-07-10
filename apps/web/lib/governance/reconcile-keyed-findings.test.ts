import { describe, expect, it, vi } from "vitest";
import {
  reconcileKeyedFindings,
  stableStringify,
  type KeyedFinding,
} from "./reconcile-keyed-findings";

type Row = { id: string; key: string | null; message: string };
type Finding = KeyedFinding & { message: string };

function harness(rows: Row[]) {
  const create = vi.fn(async (_f: Finding) => undefined);
  const update = vi.fn(async (_r: Row, _f: Finding) => undefined);
  const resolve = vi.fn(async (_r: Row) => undefined);
  const run = (findings: Finding[]) =>
    reconcileKeyedFindings<Row, Finding>({
      loadOpen: async () => rows,
      keyOf: (row) => row.key,
      findings,
      hasChanged: (row, finding) => row.message !== finding.message,
      create,
      update,
      resolve,
    });
  return { create, update, resolve, run };
}

describe("reconcileKeyedFindings", () => {
  it("creates findings that have no matching open row", async () => {
    const h = harness([]);
    const result = await h.run([{ key: "a", message: "new" }]);

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledWith({ key: "a", message: "new" });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.resolve).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 1, updated: 0, resolved: 0 });
  });

  it("updates a matched row only when hasChanged reports a difference", async () => {
    const h = harness([
      { id: "r-same", key: "same", message: "unchanged" },
      { id: "r-diff", key: "diff", message: "old" },
    ]);
    const result = await h.run([
      { key: "same", message: "unchanged" },
      { key: "diff", message: "new" },
    ]);

    expect(h.create).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith(
      { id: "r-diff", key: "diff", message: "old" },
      { key: "diff", message: "new" },
    );
    expect(result).toEqual({ created: 0, updated: 1, resolved: 0 });
  });

  it("resolves open rows whose key vanished from the findings", async () => {
    const h = harness([
      { id: "r-keep", key: "keep", message: "m" },
      { id: "r-gone", key: "gone", message: "m" },
    ]);
    const result = await h.run([{ key: "keep", message: "m" }]);

    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.resolve).toHaveBeenCalledWith({ id: "r-gone", key: "gone", message: "m" });
    expect(result).toEqual({ created: 0, updated: 0, resolved: 1 });
  });

  it("skips rows with a null key (cannot be matched or resolved)", async () => {
    const h = harness([{ id: "r-null", key: null, message: "m" }]);
    const result = await h.run([{ key: "a", message: "m" }]);

    // The null-key row is never keyed, so it is neither matched nor resolved.
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 1, updated: 0, resolved: 0 });
  });
});

describe("stableStringify", () => {
  it("is insensitive to object key order", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("sorts nested object keys recursively but preserves array order", () => {
    expect(stableStringify({ outer: { z: 1, a: [{ y: 2, x: 1 }] } })).toBe(
      stableStringify({ outer: { a: [{ x: 1, y: 2 }], z: 1 } }),
    );
    // Array element order is meaningful and preserved.
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("distinguishes genuinely different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
