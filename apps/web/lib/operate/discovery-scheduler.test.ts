import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@dpf/db", () => ({
  executeBootstrapDiscovery: vi.fn().mockResolvedValue({}),
  prisma: {},
}));

// Must import after mock setup
import { startDiscoveryScheduler, stopDiscoveryScheduler, runPrometheusTargetCheck, runFullDiscoverySweep } from "./discovery-scheduler";

describe("discovery-scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopDiscoveryScheduler();
  });

  afterEach(() => {
    stopDiscoveryScheduler();
    vi.useRealTimers();
  });

  it("startDiscoveryScheduler sets intervals", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startDiscoveryScheduler();
    // 2 intervals (prometheus poll + full sweep) + 1 setTimeout for initial check
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("stopDiscoveryScheduler clears intervals", () => {
    startDiscoveryScheduler();
    const spy = vi.spyOn(globalThis, "clearInterval");
    stopDiscoveryScheduler();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not start twice", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startDiscoveryScheduler();
    const callCount = spy.mock.calls.length;
    startDiscoveryScheduler(); // second call
    expect(spy.mock.calls.length).toBe(callCount); // no new intervals
    spy.mockRestore();
  });
});

describe("runPrometheusTargetCheck", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty when prometheus is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await runPrometheusTargetCheck();
    expect(result.newTargets).toEqual([]);
  });

  it("detects new targets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activeTargets: [
            { labels: { job: "postgres", instance: "postgres:5432" }, health: "up" },
          ],
        },
      }),
    }));

    const result = await runPrometheusTargetCheck();
    expect(result.newTargets).toContain("postgres:postgres:5432");
  });
});

describe("runFullDiscoverySweep", () => {
  it("skips if sweep already in progress", async () => {
    const { executeBootstrapDiscovery } = await import("@dpf/db");
    const mockExec = executeBootstrapDiscovery as ReturnType<typeof vi.fn>;
    mockExec.mockClear();

    // Start a slow sweep
    let resolveFirst!: () => void;
    mockExec.mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r; }));

    const first = runFullDiscoverySweep();
    // Give the first sweep time to set the flag
    await new Promise((r) => setTimeout(r, 0));
    const second = runFullDiscoverySweep(); // should skip

    resolveFirst();
    await first;
    await second;

    // Only called once (second was skipped)
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});
