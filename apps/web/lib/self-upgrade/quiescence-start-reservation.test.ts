import { expect, it, vi } from "vitest";
import { reserveQuiescenceStart, advanceOwnedQuiescenceLevel } from "./quiescence-start-reservation";

function fixture() {
  const current = { runId: "QR-existing", trigger: "self-upgrade", triggerRefId: "SUR-existing", status: "ready-to-swap", targetVersion: "old", targetBundleHash: "old", budgetMs: 300000 };
  const tx = { $executeRaw: vi.fn().mockResolvedValue(1),
    platformConfig: { findUnique: vi.fn().mockResolvedValue({ value: { level: "draining", runId: current.runId } }), upsert: vi.fn(), updateMany: vi.fn() },
    quiescenceRun: { findUnique: vi.fn().mockResolvedValue(current), findFirst: vi.fn().mockResolvedValue(current), create: vi.fn() } };
  const db = { $transaction: vi.fn(async fn => fn(tx)) };
  const runData = { runId: "QR-native", trigger: "manual", triggerRefId: "inference-runtime:RA-native", targetVersion: "source", targetBundleHash: "profile", budgetMs: 300000, status: "pending" };
  return { tx, db, runData, current };
}
it("refuses a foreign live coordinator before creating a row, even when its job slot is parked", async () => {
  const f = fixture();
  await expect(reserveQuiescenceStart({ ...f, configKey: "portal.quiescence", ifBusy: "refuse", now: new Date() })).rejects.toThrow(/owned|active/);
  expect(f.tx.$executeRaw).toHaveBeenCalled();
  expect(f.tx.quiescenceRun.create).not.toHaveBeenCalled(); expect(f.tx.platformConfig.upsert).not.toHaveBeenCalled();
});
it("an old coordinator cannot reassert or advance over a different current owner", async () => {
  const f = fixture();
  await expect(advanceOwnedQuiescenceLevel({ db: f.db, configKey: "portal.quiescence", level: "swapping", runId: "QR-native", now: new Date() })).rejects.toThrow(/owned|active/);
  expect(f.tx.platformConfig.upsert).not.toHaveBeenCalled();
});
it("reserves one pending run durably without pretending its drain is already ready", async () => {
  const f = fixture(); f.tx.platformConfig.findUnique.mockResolvedValue(null); f.tx.quiescenceRun.findFirst.mockResolvedValue(null);
  f.tx.quiescenceRun.create.mockResolvedValue(f.runData);
  const result = await reserveQuiescenceStart({ ...f, configKey: "portal.quiescence", ifBusy: "refuse", now: new Date() });
  expect(result).toMatchObject({ runId: "QR-native", created: true });
  expect(f.tx.platformConfig.upsert.mock.calls[0][0].create.value).toMatchObject({ level: "normal", runId: "QR-native" });
});
it("default joining reuses a compatible original operation and never borrows a foreign target", async () => {
  const f = fixture(); f.tx.platformConfig.findUnique.mockResolvedValue({ value: { level: "normal", runId: f.current.runId } });
  const same = { ...f.current, runId: "QR-unused" };
  expect(await reserveQuiescenceStart({ db: f.db, runData: same, configKey: "portal.quiescence", ifBusy: "join-active", now: new Date() })).toMatchObject({ runId: f.current.runId, created: false });
  await expect(reserveQuiescenceStart({ ...f, configKey: "portal.quiescence", ifBusy: "join-active", now: new Date() })).rejects.toThrow(/owned|active/);
});
