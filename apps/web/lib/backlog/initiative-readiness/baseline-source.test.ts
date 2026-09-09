import { describe, expect, it, vi } from "vitest";

import { loadBaselineSource } from "./baseline-source";

const coverage = (childItemId: string) => ({
  schemaVersion: 2,
  decision: "decomposed",
  planPath: "docs/superpowers/plans/plan.md",
  deliverables: [{ key: "slice", backlogItemId: childItemId }],
});

const t0 = new Date("2026-09-06T00:00:00.000Z");
const t1 = new Date("2026-09-07T00:00:00.000Z");

describe("loadBaselineSource (BI-2515F779)", () => {
  it("returns the item's own baseline rows when it minted any", async () => {
    const own = [{ recordedAt: t0, payload: { baselineId: "baseline-own", supersedesBaselineId: null } }];
    const findMany = vi.fn().mockResolvedValueOnce(own);
    const db = {
      backlogItem: { findFirst: vi.fn().mockResolvedValue({ id: "row-item", itemId: "BI-ITEM" }) },
      backlogItemActivity: { findMany },
    };
    const source = await loadBaselineSource(db, "BI-ITEM");
    expect(source).toEqual({
      itemRowId: "row-item",
      itemId: "BI-ITEM",
      baselineRows: own,
      origin: "own",
      inheritedFromItemId: null,
    });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("falls back to the mapping parent's baselines for a decomposed child with none of its own", async () => {
    const parentBaselines = [
      { id: "b2", kind: "initiative_scope_baseline", gateKey: null, recordedAt: t1, payload: { baselineId: "baseline-b", supersedesBaselineId: "baseline-a" } },
      { id: "r1", kind: "initiative_gate_receipt", gateKey: "spec-approval", recordedAt: t1, payload: {} },
      { id: "b1", kind: "initiative_scope_baseline", gateKey: null, recordedAt: t0, payload: { baselineId: "baseline-a", supersedesBaselineId: null } },
    ];
    const findMany = vi.fn()
      .mockResolvedValueOnce([]) // the child's own baselines
      .mockResolvedValueOnce([{ id: "cov-1", backlogItemId: "row-parent", payload: coverage("BI-CHILD") }])
      .mockResolvedValueOnce(parentBaselines);
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "row-child", itemId: "BI-CHILD" })
      .mockResolvedValueOnce({ itemId: "BI-PARENT" });
    const db = { backlogItem: { findFirst }, backlogItemActivity: { findMany } };

    const source = await loadBaselineSource(db, "BI-CHILD");

    expect(source).toMatchObject({
      itemRowId: "row-child",
      itemId: "BI-CHILD",
      origin: "inherited",
      inheritedFromItemId: "BI-PARENT",
    });
    // Only baseline rows, in recorded order; the receipt row is not a baseline.
    expect(source?.baselineRows.map((row) => (row.payload as { baselineId: string }).baselineId)).toEqual(["baseline-a", "baseline-b"]);
  });

  it("reports none when neither the item nor a mapping parent carries a baseline", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const db = {
      backlogItem: { findFirst: vi.fn().mockResolvedValue({ id: "row-item", itemId: "BI-LONE" }) },
      backlogItemActivity: { findMany },
    };
    const source = await loadBaselineSource(db, "BI-LONE");
    expect(source).toMatchObject({ origin: "none", baselineRows: [], inheritedFromItemId: null });
  });

  it("returns null for an unknown item", async () => {
    const db = {
      backlogItem: { findFirst: vi.fn().mockResolvedValue(null) },
      backlogItemActivity: { findMany: vi.fn() },
    };
    expect(await loadBaselineSource(db, "BI-NOPE")).toBeNull();
    expect(db.backlogItemActivity.findMany).not.toHaveBeenCalled();
  });
});
