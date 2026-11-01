import { describe, expect, it, vi } from "vitest";
import { BUILD_DELIVERY_ACTUATOR, enterAcceptanceOnDeployedBuild } from "./build-acceptance-entry";

function db(status: string | null, moved = 1) {
  const updateMany = vi.fn(async () => ({ count: moved }));
  const create = vi.fn(async () => ({}));
  return {
    updateMany, create,
    client: {
      featureBuild: { findUnique: vi.fn(async () => (status === null ? { originator: null } : { originator: { id: "row-1", itemId: "BI-1", status } })) },
      $transaction: async <T>(work: (tx: never) => Promise<T>) => work({ backlogItem: { updateMany }, backlogItemActivity: { create } } as never),
    },
  };
}

describe("enterAcceptanceOnDeployedBuild (BI-729D9B27)", () => {
  it("moves an open item to awaiting-acceptance with the build-delivery actuator, guarded on its status", async () => {
    const d = db("open");
    await expect(enterAcceptanceOnDeployedBuild("FB-1", d.client as never)).resolves.toBe(true);
    expect(d.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "row-1", status: "open" },
      data: expect.objectContaining({ status: "awaiting-acceptance", claimStatus: "released" }) }));
    expect(d.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "status_change",
      payload: expect.objectContaining({ actuator: BUILD_DELIVERY_ACTUATOR, buildId: "FB-1", to: "awaiting-acceptance" }) }) });
  });

  it.each([["awaiting-acceptance"], ["done"], [null]])("does nothing for an item that is %s or missing", async (status) => {
    const d = db(status);
    await expect(enterAcceptanceOnDeployedBuild("FB-1", d.client as never)).resolves.toBe(false);
    expect(d.updateMany).not.toHaveBeenCalled();
  });

  it("writes no activity when a concurrent move won", async () => {
    const d = db("in-progress", 0);
    await expect(enterAcceptanceOnDeployedBuild("FB-1", d.client as never)).resolves.toBe(false);
    expect(d.create).not.toHaveBeenCalled();
  });
});
