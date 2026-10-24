import { describe, expect, it, vi } from "vitest";

import { coverageMapsChild, loadInheritedInitiativeScope } from "./parent-scope-inheritance";

const coverage = (deliverables: unknown[], decision = "decomposed", schemaVersion = 2) => ({
  schemaVersion,
  decision,
  planPath: "docs/superpowers/plans/plan.md",
  deliverables,
});

describe("coverageMapsChild", () => {
  it("accepts a schema-2 decomposed record that names the child", () => {
    expect(coverageMapsChild(coverage([{ key: "a", backlogItemId: "BI-CHILD" }]), "BI-CHILD")).toBe(true);
  });

  it("rejects atomic, schema-1, and unmapped records", () => {
    expect(coverageMapsChild(coverage([{ key: "a", backlogItemId: "BI-CHILD" }], "atomic"), "BI-CHILD")).toBe(false);
    expect(coverageMapsChild(coverage([{ key: "a", backlogItemId: "BI-CHILD" }], "decomposed", 1), "BI-CHILD")).toBe(false);
    expect(coverageMapsChild(coverage([{ key: "a", backlogItemId: "BI-OTHER" }]), "BI-CHILD")).toBe(false);
    expect(coverageMapsChild(null, "BI-CHILD")).toBe(false);
  });
});

describe("loadInheritedInitiativeScope", () => {
  it("returns the mapping parent's scope rows", async () => {
    const parentRows = [
      { id: "b1", kind: "initiative_scope_baseline", gateKey: null, recordedAt: new Date(), payload: {} },
      { id: "r1", kind: "initiative_gate_receipt", gateKey: "spec-approval", recordedAt: new Date(), payload: {} },
    ];
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ id: "cov-1", backlogItemId: "row-parent", payload: coverage([{ key: "a", backlogItemId: "BI-CHILD" }]) }])
      .mockResolvedValueOnce(parentRows);
    const db = {
      backlogItem: { findFirst: vi.fn().mockResolvedValue({ itemId: "BI-PARENT" }) },
      backlogItemActivity: { findMany },
    };
    const scope = await loadInheritedInitiativeScope(db, { childItemId: "BI-CHILD", childRowId: "row-child" });
    expect(scope).toEqual({ parentItemId: "BI-PARENT", coverageActivityId: "cov-1", activities: parentRows });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        kind: "plan_backlog_coverage",
        backlogItemId: { not: "row-child" },
        payload: { path: ["deliverables"], array_contains: [{ backlogItemId: "BI-CHILD" }] },
      },
    });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({ where: { backlogItemId: "row-parent" } });
  });

  it("returns null when no decomposed record maps the child", async () => {
    const db = {
      backlogItem: { findFirst: vi.fn() },
      backlogItemActivity: {
        findMany: vi.fn().mockResolvedValue([
          { id: "cov-atomic", backlogItemId: "row-parent", payload: coverage([{ key: "a", backlogItemId: "BI-CHILD" }], "atomic") },
        ]),
      },
    };
    expect(await loadInheritedInitiativeScope(db, { childItemId: "BI-CHILD", childRowId: "row-child" })).toBeNull();
    expect(db.backlogItem.findFirst).not.toHaveBeenCalled();
  });
});
