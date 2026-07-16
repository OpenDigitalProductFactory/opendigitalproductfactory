// apps/web/lib/ea/ea-core.test.ts
//
// Unit tests for the pure structured-view mutation helpers extracted from
// lib/actions/ea.ts (BI-OPT-FAT-ACTIONS, EA slice). These functions are now
// side-effect-free (no prisma / auth), so they are exercised directly here.
import { describe, it, expect } from "vitest";
import {
  sortStructuredMutationRecords,
  resequenceStructuredChildren,
  insertStructuredChild,
  deriveStructuredWarnings,
  type StructuredMutationRecord,
} from "./ea-core";

function rec(
  id: string,
  parentViewElementId: string | null,
  orderIndex: number | null,
): StructuredMutationRecord {
  return { id, elementId: `${id}-el`, parentViewElementId, orderIndex };
}

describe("sortStructuredMutationRecords", () => {
  it("orders by ascending orderIndex", () => {
    const sorted = sortStructuredMutationRecords([
      rec("b", "p", 2),
      rec("a", "p", 0),
      rec("c", "p", 1),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("treats null orderIndex as last and breaks ties by id", () => {
    const sorted = sortStructuredMutationRecords([
      rec("z", "p", null),
      rec("m", "p", null),
      rec("a", "p", 0),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "m", "z"]);
  });

  it("does not mutate the input array", () => {
    const input = [rec("b", "p", 1), rec("a", "p", 0)];
    const snapshot = input.map((r) => r.id);
    sortStructuredMutationRecords(input);
    expect(input.map((r) => r.id)).toEqual(snapshot);
  });
});

describe("resequenceStructuredChildren", () => {
  it("reassigns contiguous 0..n order indices and forces the parent", () => {
    const out = resequenceStructuredChildren(
      [rec("b", "old", 5), rec("a", "old", 2), rec("c", "old", null)],
      "new-parent",
    );
    expect(out.map((r) => [r.id, r.orderIndex, r.parentViewElementId])).toEqual([
      ["a", 0, "new-parent"],
      ["b", 1, "new-parent"],
      ["c", 2, "new-parent"],
    ]);
  });
});

describe("insertStructuredChild", () => {
  it("inserts the moving record at the target index and resequences", () => {
    const out = insertStructuredChild(
      [rec("a", "p", 0), rec("b", "p", 1), rec("c", "p", 2)],
      rec("x", "other", null),
      "p",
      1,
    );
    expect(out.map((r) => r.id)).toEqual(["a", "x", "b", "c"]);
    expect(out.map((r) => r.orderIndex)).toEqual([0, 1, 2, 3]);
    expect(out.every((r) => r.parentViewElementId === "p")).toBe(true);
  });

  it("appends when targetOrderIndex is null", () => {
    const out = insertStructuredChild(
      [rec("a", "p", 0), rec("b", "p", 1)],
      rec("x", "other", null),
      "p",
      null,
    );
    expect(out.map((r) => r.id)).toEqual(["a", "b", "x"]);
  });

  it("clamps an out-of-range target index to the end", () => {
    const out = insertStructuredChild(
      [rec("a", "p", 0), rec("b", "p", 1)],
      rec("x", "other", null),
      "p",
      99,
    );
    expect(out.map((r) => r.id)).toEqual(["a", "b", "x"]);
  });

  it("drops any prior copy of the moving record before inserting", () => {
    const out = insertStructuredChild(
      [rec("a", "p", 0), rec("x", "p", 1), rec("b", "p", 2)],
      rec("x", "p", 1),
      "p",
      0,
    );
    expect(out.filter((r) => r.id === "x")).toHaveLength(1);
    expect(out.map((r) => r.id)).toEqual(["x", "a", "b"]);
  });
});

describe("deriveStructuredWarnings", () => {
  it("flags missing_required_children when attached children are below the minimum", () => {
    const warnings = deriveStructuredWarnings({
      parentViewElementId: "stream",
      minChildren: 2,
      children: [rec("s1", "stream", 0)],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.issueType).toBe("missing_required_children");
    expect(warnings[0]!.viewElementIds).toEqual(["stream"]);
  });

  it("flags a detached_child pointing at a different parent", () => {
    const warnings = deriveStructuredWarnings({
      parentViewElementId: "stream",
      minChildren: 1,
      children: [rec("s1", "stream", 0), rec("s2", "other", 0)],
    });
    const detached = warnings.find((w) => w.issueType === "detached_child");
    expect(detached).toBeDefined();
    expect(detached!.viewElementIds).toEqual(["s2"]);
    expect(detached!.details).toMatchObject({
      expectedParentViewElementId: "stream",
      actualParentViewElementId: "other",
    });
  });

  it("flags duplicate_order_index when attached siblings share an index", () => {
    const warnings = deriveStructuredWarnings({
      parentViewElementId: "stream",
      minChildren: 1,
      children: [rec("s1", "stream", 0), rec("s2", "stream", 0)],
    });
    const dup = warnings.find((w) => w.issueType === "duplicate_order_index");
    expect(dup).toBeDefined();
    expect(dup!.viewElementIds.sort()).toEqual(["s1", "s2"]);
    expect(dup!.details).toMatchObject({ orderIndex: 0 });
  });

  it("returns no warnings for a well-formed parent/children set", () => {
    const warnings = deriveStructuredWarnings({
      parentViewElementId: "stream",
      minChildren: 1,
      children: [rec("s1", "stream", 0), rec("s2", "stream", 1)],
    });
    expect(warnings).toEqual([]);
  });
});
