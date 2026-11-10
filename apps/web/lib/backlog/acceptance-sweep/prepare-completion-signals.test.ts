import { describe, expect, it, vi } from "vitest";
const external = vi.hoisted(() => ({ refresh: vi.fn(), merge: vi.fn(), deployment: vi.fn() }));
vi.mock("@/lib/backlog/initiative-readiness/merge-delivery-signal", () => ({
  refreshMergeSignalTrunk: external.refresh, resolveMergeDeliveryFromDb: external.merge, mergeSignalRoots: () => ["source"],
}));
vi.mock("@/lib/backlog/initiative-readiness/deployment-closure", () => ({ resolveBacklogDeploymentClosure: external.deployment }));
import { prepareSweepCompletionSignals } from "./prepare-completion-signals";

function fixture() {
  const item = { id:"row",itemId:"BI-TEST",workType:"bug" };
  let head = "old-head";
  const db = {
    backlogItem: { findUnique: vi.fn(async () => item) },
    workroom: { findMany: vi.fn(async () => [{headSha:head}]) },
  };
  external.merge.mockImplementation(async readDb => { await readDb.workroom.findMany({where:{backlogItemId:item.itemId}}); return "merged"; });
  external.deployment.mockResolvedValue({kind:"unavailable",reason:"no deployment"});
  return {db,item,change:()=>{head="new-head";}};
}
describe("completion signal preparation", () => {
  it("prepares external signals once and only replays reads under the fence", async () => {
    vi.clearAllMocks(); const f=fixture();
    const prepared=await prepareSweepCompletionSignals(f.db as never,"row");
    await prepared.assertCurrent(f.db as never);
    expect(await prepared.dependencies.resolveMergeDelivery!({itemRowId:"row",itemId:"BI-TEST",workType:"bug"})).toBe("merged");
    expect(external.refresh).toHaveBeenCalledTimes(1);
    expect(external.merge).toHaveBeenCalledTimes(1);
    expect(external.deployment).toHaveBeenCalledTimes(1);
    expect(f.db.workroom.findMany).toHaveBeenCalledTimes(2);
  });
  it("refuses a changed delivery input rather than reusing the prepared verdict", async () => {
    const f=fixture(); const prepared=await prepareSweepCompletionSignals(f.db as never,"row");
    f.change();
    await expect(prepared.assertCurrent(f.db as never)).rejects.toThrow("inputs changed");
  });
  it("binds prepared signals to the exact item and work type", async () => {
    const f=fixture(); const prepared=await prepareSweepCompletionSignals(f.db as never,"row");
    await expect(prepared.dependencies.resolveMergeDelivery!({itemRowId:"other",itemId:"BI-OTHER",workType:"bug"})).rejects.toThrow("identity changed");
  });
  it("does not flatten changed database dates into identical empty objects", async () => {
    const f=fixture(); let recordedAt = new Date("2026-10-01T00:00:00Z");
    f.db.workroom.findMany.mockImplementation(async () => [{headSha:"same",recordedAt}]);
    const prepared=await prepareSweepCompletionSignals(f.db as never,"row");
    recordedAt = new Date("2026-10-02T00:00:00Z");
    await expect(prepared.assertCurrent(f.db as never)).rejects.toThrow("inputs changed");
  });
});
