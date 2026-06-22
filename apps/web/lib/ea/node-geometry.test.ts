import { describe, it, expect } from "vitest";
import { resolveAbsolutePositions } from "./node-geometry";

describe("resolveAbsolutePositions", () => {
  it("returns flat (top-level) node positions unchanged", () => {
    const m = resolveAbsolutePositions([
      { id: "a", position: { x: 10, y: 20 } },
      { id: "b", position: { x: 30, y: 40 } },
    ]);
    expect(m.get("a")).toEqual({ x: 10, y: 20 });
    expect(m.get("b")).toEqual({ x: 30, y: 40 });
  });

  it("adds the parent offset for a nested child", () => {
    const m = resolveAbsolutePositions([
      { id: "P", position: { x: 100, y: 200 } },
      { id: "c", position: { x: 5, y: 8 }, parentId: "P" },
    ]);
    expect(m.get("c")).toEqual({ x: 105, y: 208 });
  });

  it("sums offsets across multi-level nesting", () => {
    const m = resolveAbsolutePositions([
      { id: "P", position: { x: 100, y: 100 } },
      { id: "Q", position: { x: 10, y: 10 }, parentId: "P" },
      { id: "r", position: { x: 1, y: 2 }, parentId: "Q" },
    ]);
    expect(m.get("r")).toEqual({ x: 111, y: 112 });
  });

  it("falls back to the raw position when the parent is missing", () => {
    const m = resolveAbsolutePositions([{ id: "c", position: { x: 5, y: 5 }, parentId: "ghost" }]);
    expect(m.get("c")).toEqual({ x: 5, y: 5 });
  });

  it("terminates on a pathological parent cycle", () => {
    const m = resolveAbsolutePositions([
      { id: "a", position: { x: 1, y: 1 }, parentId: "b" },
      { id: "b", position: { x: 2, y: 2 }, parentId: "a" },
    ]);
    expect(m.size).toBe(2);
  });
});
