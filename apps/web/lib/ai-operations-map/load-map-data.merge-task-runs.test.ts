import { describe, expect, it } from "vitest";

import { mergeTaskRunsDedupeById } from "./load-map-data";

describe("mergeTaskRunsDedupeById", () => {
  it("returns recent rows when stalled list is empty", () => {
    const recent = [{ id: "a" }, { id: "b" }];
    expect(mergeTaskRunsDedupeById(recent, [])).toEqual(recent);
  });

  it("returns stalled rows when recent list is empty", () => {
    const stalled = [{ id: "x" }, { id: "y" }];
    expect(mergeTaskRunsDedupeById([], stalled)).toEqual(stalled);
  });

  it("appends stalled rows that are not already in recent", () => {
    const recent = [{ id: "a" }, { id: "b" }];
    const stalled = [{ id: "c" }, { id: "d" }];
    expect(mergeTaskRunsDedupeById(recent, stalled).map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("dedupes rows that appear in both lists", () => {
    const recent = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const stalled = [{ id: "b" }, { id: "d" }];
    const merged = mergeTaskRunsDedupeById(recent, stalled);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(merged.filter((r) => r.id === "b")).toHaveLength(1);
  });

  it("preserves the recent-list version when the same id is in both", () => {
    const recent = [{ id: "a", source: "recent" }];
    const stalled = [{ id: "a", source: "stalled" }];
    const merged = mergeTaskRunsDedupeById(recent, stalled);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("recent");
  });

  it("handles both empty", () => {
    expect(mergeTaskRunsDedupeById([], [])).toEqual([]);
  });
});
