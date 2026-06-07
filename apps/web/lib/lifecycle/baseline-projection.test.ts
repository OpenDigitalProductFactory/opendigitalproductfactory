import { describe, it, expect } from "vitest";
import { planBaselineProjection, type ExistingMembership, type BaselineMemberInput } from "./baseline-projection";
import { resolveLifecycle } from "../lifecycle";

function member(kind: BaselineMemberInput["kind"], id: string, snapshotInput: Parameters<typeof resolveLifecycle>[0], evidenceRef = "discovery-run:R1"): BaselineMemberInput {
  return { kind, id, stateSnapshot: resolveLifecycle(snapshotInput), evidenceRef };
}

function existing(partial: Partial<ExistingMembership> & Pick<ExistingMembership, "governedThingKind" | "governedThingId">): ExistingMembership {
  return {
    id: partial.id ?? `m-${partial.governedThingKind}-${partial.governedThingId}`,
    membershipSource: "projected",
    validTo: partial.validTo ?? null,
    stateSnapshot: partial.stateSnapshot ?? {},
    ...partial,
  };
}

const activeServer = { kind: "InventoryEntity", status: "active", supportStatus: "supported" } as const;

describe("planBaselineProjection", () => {
  it("opens memberships for newly observed things", () => {
    const plan = planBaselineProjection([member("InventoryEntity", "srv-1", activeServer)], []);
    expect(plan.material).toBe(true);
    expect(plan.summary.opened).toBe(1);
    expect(plan.ops[0]).toMatchObject({ op: "open" });
  });

  it("is idempotent — unchanged evidence produces no ops", () => {
    const snap = resolveLifecycle(activeServer);
    const ex = existing({ governedThingKind: "InventoryEntity", governedThingId: "srv-1", stateSnapshot: snap });
    const plan = planBaselineProjection([member("InventoryEntity", "srv-1", activeServer)], [ex]);
    expect(plan.material).toBe(false);
    expect(plan.ops).toHaveLength(0);
    expect(plan.summary.unchanged).toBe(1);
  });

  it("refreshes when the snapshot changes (e.g. supportStatus → deprecated)", () => {
    const oldSnap = resolveLifecycle(activeServer);
    const ex = existing({ governedThingKind: "InventoryEntity", governedThingId: "srv-1", stateSnapshot: oldSnap });
    const plan = planBaselineProjection(
      [member("InventoryEntity", "srv-1", { kind: "InventoryEntity", status: "active", supportStatus: "deprecated" })],
      [ex],
    );
    expect(plan.summary.refreshed).toBe(1);
    expect(plan.ops[0]).toMatchObject({ op: "refresh", reopened: false });
  });

  it("reopens a previously-closed membership when the thing reappears", () => {
    const ex = existing({ governedThingKind: "InventoryEntity", governedThingId: "srv-1", validTo: new Date("2026-01-01"), stateSnapshot: resolveLifecycle(activeServer) });
    const plan = planBaselineProjection([member("InventoryEntity", "srv-1", activeServer)], [ex]);
    expect(plan.summary.reopened).toBe(1);
    expect(plan.ops[0]).toMatchObject({ op: "refresh", reopened: true });
  });

  it("closes memberships that left the current-state estate", () => {
    const ex = existing({ governedThingKind: "InventoryEntity", governedThingId: "gone-1", stateSnapshot: resolveLifecycle(activeServer) });
    const plan = planBaselineProjection([], [ex]);
    expect(plan.summary.closed).toBe(1);
    expect(plan.ops[0]).toMatchObject({ op: "close" });
  });

  it("ignores already-closed memberships that stay absent", () => {
    const ex = existing({ governedThingKind: "InventoryEntity", governedThingId: "gone-1", validTo: new Date("2026-01-01"), stateSnapshot: resolveLifecycle(activeServer) });
    const plan = planBaselineProjection([], [ex]);
    expect(plan.material).toBe(false);
    expect(plan.ops).toHaveLength(0);
  });

  it("treats an empty/incomplete stored snapshot as changed (forces refresh)", () => {
    const ex = existing({ governedThingKind: "InventoryEntity", governedThingId: "srv-1", stateSnapshot: {} });
    const plan = planBaselineProjection([member("InventoryEntity", "srv-1", activeServer)], [ex]);
    expect(plan.summary.refreshed).toBe(1);
  });

  it("handles a mixed batch deterministically (open + close + unchanged)", () => {
    const snap = resolveLifecycle(activeServer);
    const ex = [
      existing({ governedThingKind: "InventoryEntity", governedThingId: "keep", stateSnapshot: snap }),
      existing({ governedThingKind: "InventoryEntity", governedThingId: "gone", stateSnapshot: snap }),
    ];
    const plan = planBaselineProjection(
      [member("InventoryEntity", "keep", activeServer), member("DigitalProduct", "new", { kind: "DigitalProduct", lifecycleStage: "production", lifecycleStatus: "active" })],
      ex,
    );
    expect(plan.summary).toMatchObject({ opened: 1, closed: 1, unchanged: 1, refreshed: 0, reopened: 0 });
    expect(plan.material).toBe(true);
  });
});
