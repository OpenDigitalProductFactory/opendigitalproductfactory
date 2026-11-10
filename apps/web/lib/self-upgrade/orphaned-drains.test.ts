import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ candidates: vi.fn(), parent: vi.fn(), transition: vi.fn(), level: vi.fn(), send: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { quiescenceRun: { findMany: mocks.candidates }, selfUpgradeRun: { findUnique: mocks.parent } } }));
vi.mock("./quiescence", () => ({ transitionState: mocks.transition, setQuiescenceLevel: mocks.level, broadcastQuiescenceCleared: mocks.send }));
import { recoverOrphanedUpgradeDrains } from "./orphaned-drains";
import { LANDED_SWAP_FALSE_FAILURE_REASON } from "./landed-swap-identity";
const now = new Date("2026-09-21T02:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.candidates.mockResolvedValue([{ runId: "QR-old", status: "ready-to-swap", triggerRefId: "SUR-old", lastHeartbeatAt: null }]);
});
it.each(["running", "queued", "succeeded"])("preserves a %s parent regardless of missing heartbeat", async status => {
  mocks.parent.mockResolvedValue({ status, completedAt: new Date(0) });
  expect(await recoverOrphanedUpgradeDrains(now)).toBe(0);
  expect(mocks.transition).not.toHaveBeenCalled();
});
it("preserves a recently failed caller during its recovery grace", async () => {
  mocks.parent.mockResolvedValue({ status: "failed", completedAt: now });
  expect(await recoverOrphanedUpgradeDrains(now)).toBe(0);
});
it("recovers an old ready-to-swap row whose parent definitively failed", async () => {
  mocks.parent.mockResolvedValue({ status: "failed", completedAt: new Date("2026-09-06T19:05:50Z") });
  expect(await recoverOrphanedUpgradeDrains(now)).toBe(1);
  expect(mocks.transition).toHaveBeenCalledWith("QR-old", "failed", expect.objectContaining({ completionSource: "watchdog" }), now, { status: "ready-to-swap", lastHeartbeatAt: null });
  expect(mocks.level).toHaveBeenCalledWith("normal", null, now, "QR-old");
  expect(mocks.send).toHaveBeenCalledOnce();
});
it("does not clear the global level if the candidate advanced concurrently", async () => {
  mocks.parent.mockResolvedValue({ status: "failed", completedAt: new Date(0) });
  mocks.transition.mockRejectedValue(new Error("concurrent transition"));
  expect(await recoverOrphanedUpgradeDrains(now)).toBe(0);
  expect(mocks.level).not.toHaveBeenCalled();
});

it("preserves a repairable late failure when its parent heals after lookup", async () => {
  let parentStatus: string = "failed";
  const parent: Record<string, unknown> = {
    status: parentStatus,
    completedAt: new Date("2026-09-06T19:05:50Z"),
    reason: LANDED_SWAP_FALSE_FAILURE_REASON,
  };
  mocks.parent.mockImplementation(async ({ select }: { select: Record<string, boolean> }) => {
    const snapshot = Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, parent[key]]));
    queueMicrotask(() => { parentStatus = "succeeded"; });
    return snapshot;
  });
  expect(await recoverOrphanedUpgradeDrains(now)).toBe(0);
  expect(parentStatus).toBe("succeeded");
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.level).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
