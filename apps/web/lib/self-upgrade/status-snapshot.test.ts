import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLatestRun: vi.fn(),
  getQuiescenceActivity: vi.fn(),
  getCooldownUntil: vi.fn(),
  getJobEngineHealth: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/run-store", () => ({ getLatestRun: mocks.getLatestRun }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceActivity: mocks.getQuiescenceActivity,
}));
vi.mock("@/lib/self-upgrade/cooldown", () => ({ getCooldownUntil: mocks.getCooldownUntil }));
vi.mock("@/lib/queue/job-engine-health", () => ({ getJobEngineHealth: mocks.getJobEngineHealth }));

import { getSelfUpgradeStatusSnapshot } from "./status-snapshot";

describe("getSelfUpgradeStatusSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestRun.mockResolvedValue({ runId: "SUR-1", status: "running" });
    mocks.getQuiescenceActivity.mockResolvedValue({ level: "normal", blockers: [] });
    mocks.getCooldownUntil.mockResolvedValue(new Date("2026-08-01T01:00:00.000Z"));
    mocks.getJobEngineHealth.mockResolvedValue({ status: "healthy", detail: null });
  });

  it("builds an authenticated projection from bounded operational reads", async () => {
    const snapshot = await getSelfUpgradeStatusSnapshot(
      new Date("2026-08-01T00:00:00.000Z"),
    );

    expect(snapshot).toMatchObject({
      observedAt: "2026-08-01T00:00:00.000Z",
      latestRun: { runId: "SUR-1", status: "running" },
      quiescence: { level: "normal" },
      cooldownUntil: "2026-08-01T01:00:00.000Z",
      jobEngine: { status: "healthy" },
    });
  });
});
