/**
 * BI-F9EE05E5 — the periodic self-upgrade reconciler must never fail a run
 * whose drain is still heartbeating. An upgrade now waits up to an hour (or
 * longer, awaiting the operator) for work, so 30 minutes since startedAt is no
 * longer evidence that the orchestrator died.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getDeployedSha: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  selfUpgradeRunFindMany: vi.fn(),
  selfUpgradeRunsWithLiveDrain: vi.fn(),
  isLiveSelfUpgradeDrain: vi.fn(),
  platformConfigFindUnique: vi.fn(),
  setQuiescenceLevel: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/completion", () => ({ getDeployedSha: m.getDeployedSha }));
vi.mock("@/lib/self-upgrade/run-store", () => ({ completeRun: m.completeRun, failRun: m.failRun }));
vi.mock("@/lib/self-upgrade/drain-wait", () => ({
  selfUpgradeRunsWithLiveDrain: m.selfUpgradeRunsWithLiveDrain,
  isLiveSelfUpgradeDrain: m.isLiveSelfUpgradeDrain,
}));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ QUIESCENCE_CONFIG_KEY: "portal.quiescence", setQuiescenceLevel: m.setQuiescenceLevel }));
vi.mock("@dpf/db", () => ({
  prisma: { selfUpgradeRun: { findMany: m.selfUpgradeRunFindMany }, platformConfig: { findUnique: m.platformConfigFindUnique } },
}));

import { reconcileSelfUpgradeRunsOnBoot, resetStuckQuiescenceLevelOnBoot } from "./instrumentation";

const NOW = new Date("2026-09-30T19:00:00.000Z");
const quiet = { log: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  m.getDeployedSha.mockResolvedValue("running-sha");
  m.failRun.mockResolvedValue({});
  m.selfUpgradeRunFindMany
    .mockResolvedValueOnce([
      { runId: "SUR-WAITING", deployedSha: "target-a", targetSha: "target-a", currentSha: "running-sha" },
      { runId: "SUR-ORPHAN", deployedSha: "target-b", targetSha: "target-b", currentSha: "running-sha" },
    ])
    .mockResolvedValueOnce([]);
});

describe("reconcileSelfUpgradeRunsOnBoot — periodic mode and a waiting drain (BI-F9EE05E5)", () => {
  it("leaves a run whose drain still heartbeats, and fails only the orphan", async () => {
    m.selfUpgradeRunsWithLiveDrain.mockResolvedValue(new Set(["SUR-WAITING"]));

    const r = await reconcileSelfUpgradeRunsOnBoot(quiet, { staleAfterMs: 30 * 60 * 1000, now: () => NOW });

    expect(r).toEqual({ succeeded: 0, failed: 1 });
    expect(m.selfUpgradeRunsWithLiveDrain).toHaveBeenCalledWith(["SUR-WAITING", "SUR-ORPHAN"], NOW, 30 * 60 * 1000);
    expect(m.failRun).toHaveBeenCalledTimes(1);
    expect(m.failRun).toHaveBeenCalledWith("SUR-ORPHAN", expect.stringContaining("Reconciled by watchdog"));
  });

  it("boot mode does not consult the drain (the orchestrator is gone after a boot)", async () => {
    await reconcileSelfUpgradeRunsOnBoot(quiet, { now: () => NOW });
    expect(m.selfUpgradeRunsWithLiveDrain).not.toHaveBeenCalled();
  });
});

describe("resetStuckQuiescenceLevelOnBoot — a live drain keeps admission closed (BI-F9EE05E5)", () => {
  beforeEach(() => {
    m.platformConfigFindUnique.mockResolvedValue({ value: { level: "draining", runId: "QR-1" } });
  });

  it("leaves the level alone while the named self-upgrade drain still heartbeats", async () => {
    m.isLiveSelfUpgradeDrain.mockResolvedValue(true);
    expect(await resetStuckQuiescenceLevelOnBoot(quiet)).toBe(false);
    expect(m.isLiveSelfUpgradeDrain).toHaveBeenCalledWith("QR-1");
    expect(m.setQuiescenceLevel).not.toHaveBeenCalled();
  });

  it("resets an orphaned drain (no live coordinator) to normal", async () => {
    m.isLiveSelfUpgradeDrain.mockResolvedValue(false);
    expect(await resetStuckQuiescenceLevelOnBoot(quiet)).toBe(true);
    expect(m.setQuiescenceLevel).toHaveBeenCalledWith("normal", null);
  });
});
