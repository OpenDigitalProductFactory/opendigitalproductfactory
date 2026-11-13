import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SANDBOX_LEASE_IDLE_MS,
  classifySandboxLease,
  reclaimSandboxLeases,
  sandboxLeaseIdleMs,
  type HeldSandboxLease,
  type SandboxLeaseLiveness,
} from "./sandbox-lease-reclaim";

const NOW = new Date("2026-10-28T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const IDLE_MS = DEFAULT_SANDBOX_LEASE_IDLE_MS;

const open = (phase = "build"): SandboxLeaseLiveness["build"] => ({ phase, abandonedAt: null });

describe("classifySandboxLease", () => {
  it("releases an idle lease once the window has passed", () => {
    expect(
      classifySandboxLease({ build: open(), lastSignalAt: minutesAgo(61), liveTaskRunCount: 0, acquiredAt: minutesAgo(90), now: NOW, idleMs: IDLE_MS }),
    ).toBe("release-idle");
  });

  it("keeps a lease with recent activity", () => {
    expect(
      classifySandboxLease({ build: open(), lastSignalAt: minutesAgo(5), liveTaskRunCount: 0, acquiredAt: minutesAgo(90), now: NOW, idleMs: IDLE_MS }),
    ).toBe("keep");
  });

  it("keeps a lease acquired recently even when the build's last signal is old", () => {
    expect(
      classifySandboxLease({ build: open(), lastSignalAt: minutesAgo(600), liveTaskRunCount: 0, acquiredAt: minutesAgo(10), now: NOW, idleMs: IDLE_MS }),
    ).toBe("keep");
  });

  it("never releases an open build with a live task run", () => {
    expect(
      classifySandboxLease({ build: open(), lastSignalAt: minutesAgo(600), liveTaskRunCount: 1, acquiredAt: minutesAgo(600), now: NOW, idleMs: IDLE_MS }),
    ).toBe("keep");
  });

  it("keeps a lease with no freshness signal at all", () => {
    expect(
      classifySandboxLease({ build: open(), lastSignalAt: null, liveTaskRunCount: 0, acquiredAt: null, now: NOW, idleMs: IDLE_MS }),
    ).toBe("keep");
  });

  it("releases leases held for missing, terminal or abandoned builds", () => {
    const base = { lastSignalAt: minutesAgo(1), liveTaskRunCount: 0, acquiredAt: minutesAgo(1), now: NOW, idleMs: IDLE_MS };
    expect(classifySandboxLease({ ...base, build: null })).toBe("release-orphan");
    expect(classifySandboxLease({ ...base, build: open("complete") })).toBe("release-orphan");
    expect(classifySandboxLease({ ...base, build: { phase: "build", abandonedAt: minutesAgo(2) } })).toBe("release-orphan");
  });
});

describe("sandboxLeaseIdleMs", () => {
  it("defaults to 60 minutes and accepts a positive override", () => {
    expect(sandboxLeaseIdleMs({})).toBe(60 * 60 * 1000);
    expect(sandboxLeaseIdleMs({ DPF_SANDBOX_LEASE_IDLE_MS: "120000" })).toBe(120_000);
    expect(sandboxLeaseIdleMs({ DPF_SANDBOX_LEASE_IDLE_MS: "nope" })).toBe(60 * 60 * 1000);
  });
});

describe("reclaimSandboxLeases", () => {
  const leases: HeldSandboxLease[] = [
    { buildId: "FB-IDLE", containerId: "dpf-sandbox-1", acquiredAt: minutesAgo(120) },
    { buildId: "FB-ACTIVE", containerId: "dpf-sandbox-2-1", acquiredAt: minutesAgo(120) },
    { buildId: "FB-DONE", containerId: "dpf-sandbox-3-1", acquiredAt: minutesAgo(120) },
  ];
  const liveness: Record<string, SandboxLeaseLiveness> = {
    "FB-IDLE": { build: open(), lastSignalAt: minutesAgo(90), liveTaskRunCount: 0 },
    "FB-ACTIVE": { build: open("review"), lastSignalAt: minutesAgo(2), liveTaskRunCount: 0 },
    "FB-DONE": { build: open("complete"), lastSignalAt: minutesAgo(30), liveTaskRunCount: 0 },
  };

  function deps() {
    return {
      listHeldLeases: vi.fn(async () => leases),
      readLiveness: vi.fn(async (buildId: string) => liveness[buildId]!),
      releaseLease: vi.fn(async () => {}),
      recordActivity: vi.fn(async () => {}),
    };
  }

  it("releases the idle and orphaned leases and keeps the active one when enabled", async () => {
    const d = deps();
    const result = await reclaimSandboxLeases({ env: { DPF_SANDBOX_LEASE_RECLAIM_ENABLED: "1" }, now: NOW, deps: d });

    expect(result.mode).toBe("enforce");
    expect(result.released.sort()).toEqual(["FB-DONE", "FB-IDLE"]);
    expect(d.releaseLease).not.toHaveBeenCalledWith("FB-ACTIVE");
    expect(d.recordActivity).toHaveBeenCalledWith("FB-IDLE", expect.stringContaining("takes a slot again"));
    expect(d.recordActivity).toHaveBeenCalledWith("FB-DONE", expect.stringContaining("complete"));
  });

  it("observes without releasing by default", async () => {
    const d = deps();
    const result = await reclaimSandboxLeases({ env: {}, now: NOW, deps: d });

    expect(result.mode).toBe("observe");
    expect(result.candidates.map((c) => [c.buildId, c.decision]).sort()).toEqual([
      ["FB-DONE", "release-orphan"],
      ["FB-IDLE", "release-idle"],
    ]);
    expect(result.released).toEqual([]);
    expect(d.releaseLease).not.toHaveBeenCalled();
    expect(d.recordActivity).not.toHaveBeenCalled();
  });

  it("keeps a lease whose build came alive between the scan and the release", async () => {
    const d = deps();
    d.readLiveness
      .mockResolvedValueOnce(liveness["FB-IDLE"]!)
      .mockResolvedValueOnce({ ...liveness["FB-IDLE"]!, liveTaskRunCount: 1 });
    d.listHeldLeases.mockResolvedValueOnce([leases[0]!]);

    const result = await reclaimSandboxLeases({ env: { DPF_SANDBOX_LEASE_RECLAIM_ENABLED: "1" }, now: NOW, deps: d });

    expect(result.released).toEqual([]);
    expect(d.releaseLease).not.toHaveBeenCalled();
  });

  it("does not record activity for a lease whose build row is gone", async () => {
    const d = deps();
    d.listHeldLeases.mockResolvedValueOnce([{ buildId: "FB-GONE", containerId: "dpf-sandbox-1", acquiredAt: minutesAgo(5) }]);
    d.readLiveness.mockResolvedValue({ build: null, lastSignalAt: null, liveTaskRunCount: 0 });

    const result = await reclaimSandboxLeases({ env: { DPF_SANDBOX_LEASE_RECLAIM_ENABLED: "1" }, now: NOW, deps: d });

    expect(result.released).toEqual(["FB-GONE"]);
    expect(d.recordActivity).not.toHaveBeenCalled();
  });

  it("continues past a lease that fails", async () => {
    const d = deps();
    d.releaseLease.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await reclaimSandboxLeases({ env: { DPF_SANDBOX_LEASE_RECLAIM_ENABLED: "1" }, now: NOW, deps: d });

    expect(result.released).toEqual(["FB-DONE"]);
    warn.mockRestore();
  });
});
