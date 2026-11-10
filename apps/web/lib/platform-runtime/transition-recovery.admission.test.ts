import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ count: vi.fn(), findMany: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { runtimeCapabilityTransition: mocks } }));
vi.mock("@/lib/self-upgrade/promoter", () => ({ runPromoter: vi.fn() }));

const stateKey = Symbol.for("dpf.runtime-capability-admission.v1");
const load = () => import("./transition-recovery");
const host = () => ({
  protocolSecret: "s".repeat(32),
  readReceipt: vi.fn(), relaunch: vi.fn(), compensate: vi.fn(),
  reconcileAuthority: vi.fn().mockResolvedValue(undefined),
});

describe("runtime admission across server module caches", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, stateKey);
    vi.resetModules(); vi.resetAllMocks();
    mocks.count.mockResolvedValue(0); mocks.findMany.mockResolvedValue([]);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); Reflect.deleteProperty(globalThis, stateKey); });

  it("keeps one receipt observer across module caches and skips overlapping passes", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const settle = vi.fn().mockReturnValueOnce(blocked).mockResolvedValue(undefined);
    const report = vi.fn();
    (await load()).startRuntimeCapabilityReceiptSettlement(settle, report);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settle).toHaveBeenCalledOnce();
    vi.resetModules();
    (await load()).startRuntimeCapabilityReceiptSettlement(settle, report);
    release(); await vi.advanceTimersByTimeAsync(30_000);
    expect(settle).toHaveBeenCalledTimes(2);
    expect(report).not.toHaveBeenCalled();
  });

  it("retries observation after an IO failure without reopening failed startup admission", async () => {
    vi.useFakeTimers();
    const module = await load();
    const settle = vi.fn().mockRejectedValueOnce(new Error("receipt mount unavailable")).mockResolvedValue(undefined);
    const report = vi.fn();
    module.startRuntimeCapabilityReceiptSettlement(settle, report);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settle).toHaveBeenCalledTimes(2); expect(report).toHaveBeenCalledOnce();
    await expect(module.assertRuntimeCapabilityTransitionAdmission()).rejects.toThrow("runtime_capability_reconciliation_in_progress");
  });

  it("refuses a request before this process completes startup", async () => {
    await expect((await load()).assertRuntimeCapabilityTransitionAdmission())
      .rejects.toThrow("runtime_capability_reconciliation_in_progress");
  });

  it("admits a separately loaded request module after successful startup", async () => {
    const startup = await load();
    await startup.reconcileRuntimeCapabilityTransitionsOnStartup(host());
    vi.resetModules();
    await expect((await load()).assertRuntimeCapabilityTransitionAdmission()).resolves.toBeUndefined();
    expect(mocks.count).toHaveBeenCalledTimes(2);
  });

  it("closes the original request module when another cache fails reconciliation", async () => {
    const request = await load();
    await request.reconcileRuntimeCapabilityTransitionsOnStartup(host());
    vi.resetModules();
    const failingHost = host();
    failingHost.reconcileAuthority.mockRejectedValue(new Error("authority unavailable"));
    await expect((await load()).reconcileRuntimeCapabilityTransitionsOnStartup(failingHost))
      .rejects.toThrow("authority unavailable");
    await expect(request.assertRuntimeCapabilityTransitionAdmission())
      .rejects.toThrow("runtime_capability_reconciliation_in_progress");
  });

  it.each([
    [1, 0, "runtime_capability_reconciliation_in_progress"],
    [0, 1, "runtime_capability_recovery_required"],
  ])("rechecks durable blockers after shared readiness (%i, %i)", async (active, recovery, error) => {
    await (await load()).reconcileRuntimeCapabilityTransitionsOnStartup(host());
    vi.resetModules();
    mocks.count.mockResolvedValueOnce(active).mockResolvedValueOnce(recovery);
    await expect((await load()).assertRuntimeCapabilityTransitionAdmission()).rejects.toThrow(error);
  });

  it("does not let an older startup reopen admission after newer recovery fails", async () => {
    const older = await load();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const olderHost = host();
    olderHost.reconcileAuthority.mockImplementationOnce(() => pending);
    const olderStartup = older.reconcileRuntimeCapabilityTransitionsOnStartup(olderHost);
    await vi.waitFor(() => expect(olderHost.reconcileAuthority).toHaveBeenCalled());
    vi.resetModules();
    const newerHost = host();
    newerHost.reconcileAuthority.mockRejectedValue(new Error("authority unavailable"));
    await expect((await load()).reconcileRuntimeCapabilityTransitionsOnStartup(newerHost))
      .rejects.toThrow("authority unavailable");
    release();
    await olderStartup;
    await expect(older.assertRuntimeCapabilityTransitionAdmission())
      .rejects.toThrow("runtime_capability_reconciliation_in_progress");
  });
});
