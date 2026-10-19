/**
 * BI-75ECED42 — an upgrade killed by the container engine restarting (Docker
 * Desktop updating itself, a host reboot) is named as that, not as "the
 * orchestrator did not complete the swap". Live 2026-10-02, SUR-8782FCBD: the
 * run began 14:26:56Z, Docker Desktop restarted at 14:28:41, Postgres came back
 * at 14:29:10.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getDeployedSha: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  selfUpgradeRunFindMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/completion", () => ({ getDeployedSha: m.getDeployedSha }));
vi.mock("@/lib/self-upgrade/run-store", () => ({ completeRun: m.completeRun, failRun: m.failRun }));
vi.mock("@/lib/self-upgrade/drain-wait", () => ({ selfUpgradeRunsWithLiveDrain: vi.fn(async () => new Set()) }));
vi.mock("@dpf/db", () => ({
  prisma: { selfUpgradeRun: { findMany: m.selfUpgradeRunFindMany }, $queryRaw: m.queryRaw },
}));

import { reconcileSelfUpgradeRunsOnBoot } from "./instrumentation";

const quiet = { log: vi.fn(), error: vi.fn() };
const run = {
  runId: "SUR-8782FCBD",
  startedAt: new Date("2026-10-02T14:26:56Z"),
  currentSha: "bb7c2a806",
  deployedSha: null,
  targetSha: "b933644bc",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getDeployedSha.mockResolvedValue("bb7c2a806");
  m.failRun.mockResolvedValue({});
  m.selfUpgradeRunFindMany.mockResolvedValueOnce([run]).mockResolvedValue([]);
});

describe("reconcileSelfUpgradeRunsOnBoot — the container engine restarted under the run", () => {
  it("fails the run as engine-restarted when the database started after the run began", async () => {
    m.queryRaw.mockResolvedValue([{ started: new Date("2026-10-02T14:29:10Z") }]);
    await reconcileSelfUpgradeRunsOnBoot(quiet);
    expect(m.failRun).toHaveBeenCalledWith(
      "SUR-8782FCBD",
      expect.stringContaining("the container engine restarted during this upgrade"),
      "engine-restarted",
    );
  });

  it("keeps the existing swap-pending rule when the database did not restart", async () => {
    m.queryRaw.mockResolvedValue([{ started: new Date("2026-10-01T09:00:00Z") }]);
    await reconcileSelfUpgradeRunsOnBoot(quiet);
    expect(m.failRun).not.toHaveBeenCalled();
  });

  it("falls back to the existing rules when the database start time cannot be read", async () => {
    m.queryRaw.mockRejectedValue(new Error("no"));
    await reconcileSelfUpgradeRunsOnBoot(quiet);
    expect(m.failRun).not.toHaveBeenCalled();
  });
});
