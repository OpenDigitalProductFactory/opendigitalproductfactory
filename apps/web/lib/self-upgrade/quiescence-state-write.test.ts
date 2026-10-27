import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), configUpdateMany: vi.fn(), configUpsert: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { quiescenceRun: db, platformConfig: { updateMany: db.configUpdateMany, upsert: db.configUpsert } } }));
import { heartbeatQuiescenceRun, transitionState, setQuiescenceLevel } from "./quiescence";

beforeEach(() => vi.resetAllMocks());
describe("quiescence terminal ownership (BI-7289199B)", () => {
  it("preserves the original drain start if a committed step is retried before checkpointing", async () => {
    const enteredStateAt = { draining: "2026-09-21T01:36:14.994Z" };
    db.findUnique.mockResolvedValue({ status: "draining", enteredStateAt });
    db.update.mockResolvedValue({ status: "draining", enteredStateAt: { draining: "2026-09-21T01:40:00.000Z" } });
    await expect(transitionState("QR-retry", "draining", {}, new Date("2026-09-21T01:40:00Z")))
      .resolves.toEqual({ status: "draining", enteredStateAt });
    expect(db.update).not.toHaveBeenCalled();
  });
  it("allows a committed terminal step to finish cleanup when its checkpoint was lost", async () => {
    const enteredStateAt = { deferred: "2026-09-21T01:41:14.994Z" };
    db.findUnique.mockResolvedValue({ status: "deferred", enteredStateAt });
    await expect(transitionState("QR-retry", "deferred")).resolves.toEqual({ status: "deferred", enteredStateAt });
    expect(db.update).not.toHaveBeenCalled();
  });
  it("does not let a resumed coordinator overwrite watchdog failure", async () => {
    db.findUnique.mockResolvedValue({ status: "failed", enteredStateAt: {} });
    db.update.mockResolvedValue({ status: "deferred", enteredStateAt: {} });
    await expect(transitionState("QR-old", "deferred")).rejects.toThrow(/terminal/);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("does not clear a newer drain when the old coordinator finishes", async () => {
    db.configUpdateMany.mockResolvedValue({ count: 0 });
    await setQuiescenceLevel("normal", null, new Date(), "QR-old");
    expect(db.configUpdateMany.mock.calls[0][0].where).toMatchObject({ value: { path: ["runId"], equals: "QR-old" } });
    expect(db.configUpsert).not.toHaveBeenCalled();
  });
  it("fences a watchdog write against the heartbeat it observed", async () => {
    const heartbeat = new Date("2026-09-21T01:38:44Z");
    db.findUnique.mockResolvedValue({ status: "draining", enteredStateAt: {} });
    db.update.mockRejectedValue(new Error("concurrent heartbeat"));
    await expect(transitionState("QR-live", "failed", {}, new Date(), { status: "draining", lastHeartbeatAt: heartbeat })).rejects.toThrow("concurrent heartbeat");
    expect(db.update.mock.calls[0][0].where).toMatchObject({ status: "draining", lastHeartbeatAt: heartbeat });
  });
  it("compares the observed status when committing a transition", async () => {
    db.findUnique.mockResolvedValue({ status: "draining", enteredStateAt: {} });
    db.update.mockResolvedValue({ status: "ready-to-swap", enteredStateAt: {} });
    await transitionState("QR-live", "ready-to-swap");
    expect(db.update.mock.calls[0][0].where).toEqual({ runId: "QR-live", status: "draining" });
  });
  it("stops a heartbeat on a reaped run instead of reviving it", async () => {
    db.updateMany.mockResolvedValue({ count: 0 });
    await expect(heartbeatQuiescenceRun("QR-old")).rejects.toThrow(/terminal|missing/);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("preserves evidence-backed boot reconciliation of a landed swap", async () => {
    db.findUnique.mockResolvedValue({ status: "failed", enteredStateAt: {} });
    db.update.mockResolvedValue({ status: "completed", enteredStateAt: {} });
    await expect(transitionState("QR-landed", "completed", { completionSource: "boot-reconciler", outcome: "succeeded" })).resolves.toMatchObject({ status: "completed" });
  });
});
