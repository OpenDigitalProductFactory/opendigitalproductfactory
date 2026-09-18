import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSelfUpgrade: vi.fn(),
  getSelfUpgradeConfig: vi.fn(),
  readSelfUpgradeSupport: vi.fn(),
  resolveReleaseBatchStatus: vi.fn(),
  getLatestRun: vi.fn(),
  getLastCheckedAt: vi.fn(),
  getScheduledDecline: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/request", () => ({
  requestSelfUpgrade: mocks.requestSelfUpgrade,
}));
vi.mock("@/lib/self-upgrade/config", () => ({
  getSelfUpgradeConfig: mocks.getSelfUpgradeConfig,
}));
vi.mock("@/lib/self-upgrade/support", () => ({
  readSelfUpgradeSupport: mocks.readSelfUpgradeSupport,
}));
vi.mock("@/lib/self-upgrade/release-batch-status", () => ({
  resolveReleaseBatchStatus: mocks.resolveReleaseBatchStatus,
}));
vi.mock("@/lib/self-upgrade/run-store", () => ({
  getLatestRun: mocks.getLatestRun,
}));
vi.mock("@/lib/self-upgrade/last-check", () => ({
  getLastCheckedAt: mocks.getLastCheckedAt,
}));
// Keep the real schedule arithmetic; stub only its DB reader, so the status the
// test asserts is produced by the same functions the cron gate uses.
vi.mock("@/lib/self-upgrade/scheduled-gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/self-upgrade/scheduled-gate")>()),
  getScheduledDecline: mocks.getScheduledDecline,
  recordScheduledDecline: vi.fn(),
}));

import { selfUpgradePack } from "./self-upgrade-pack";

const support = {
  configuredEnabled: true,
  supported: true,
  enabled: true,
  targetKind: "release-artifact",
  reason: "enabled",
  message: null,
};

async function call(name: keyof typeof selfUpgradePack.handlers) {
  return selfUpgradePack.handlers[name]({}, "user-1", { agentId: "codex" });
}

describe("self-upgrade MCP tools on consumer installs", () => {
  beforeEach(() => {
    mocks.getSelfUpgradeConfig.mockResolvedValue({ enabled: true, sourceMode: "upstream" });
    mocks.readSelfUpgradeSupport.mockResolvedValue(support);
    mocks.resolveReleaseBatchStatus.mockResolvedValue({
      applicable: false,
      eligible: true,
      reason: "release-artifact",
      pendingCount: null,
      minPendingPrs: 10,
      maxWaitHours: 168,
      oldestPendingAt: null,
      lineageSha: null,
      summary: "Published releases are already verified as a complete batch; Git commit batching does not apply.",
      support,
    });
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.getLastCheckedAt.mockResolvedValue(null);
    mocks.getScheduledDecline.mockResolvedValue(null);
  });

  it("returns the queued artifact-native dispatch result", async () => {
    mocks.requestSelfUpgrade.mockResolvedValue({
      success: true,
      status: "queued",
      runId: "SUR-CONSUMER",
      triggeredBy: "mcp:codex",
      eventIds: ["evt-1"],
    });
    expect(await call("request_self_upgrade")).toMatchObject({
      success: true,
      data: { status: "queued", runId: "SUR-CONSUMER" },
    });
  });

  it("reports enabled and routine-upgrade eligible", async () => {
    expect(await call("get_self_upgrade_queue_status")).toMatchObject({
      success: true,
      data: {
        supported: true,
        enabled: true,
        routineUpgradeEligible: true,
        releaseBatchEligible: true,
        nextScheduledCheckAt: null,
        scheduledGate: null,
      },
    });
  });

  it("BI-3CA18934: is NOT routine-eligible while the unattended check is throttled, and says when it is due", async () => {
    mocks.getSelfUpgradeConfig.mockResolvedValue({ enabled: true, sourceMode: "upstream", checkIntervalHours: 24 });
    mocks.getLastCheckedAt.mockResolvedValue(new Date(Date.now() - 2 * 60 * 60 * 1000));
    mocks.getScheduledDecline.mockResolvedValue({
      reason: "interval-not-elapsed",
      at: new Date().toISOString(),
    });

    const result = await call("get_self_upgrade_queue_status") as unknown as {
      data: { routineUpgradeEligible: boolean; releaseBatchEligible: boolean; nextScheduledCheckAt: string | null; checkIntervalHours: number; scheduledGate: { reason: string } | null };
    };

    // The release batch still allows an upgrade; the unattended path does not.
    expect(result.data.releaseBatchEligible).toBe(true);
    expect(result.data.routineUpgradeEligible).toBe(false);
    expect(result.data.checkIntervalHours).toBe(24);
    expect(result.data.nextScheduledCheckAt).not.toBeNull();
    expect(result.data.scheduledGate).toMatchObject({ reason: "interval-not-elapsed" });
  });

  it("BI-3CA18934: drops a stale decline recorded before the last successful check", async () => {
    mocks.getSelfUpgradeConfig.mockResolvedValue({ enabled: true, sourceMode: "upstream", checkIntervalHours: 24 });
    mocks.getLastCheckedAt.mockResolvedValue(new Date("2026-09-07T05:39:09.895Z"));
    mocks.getScheduledDecline.mockResolvedValue({ reason: "outside-window", at: "2026-09-07T04:00:00.000Z" });

    const result = await call("get_self_upgrade_queue_status") as unknown as { data: { scheduledGate: unknown } };
    expect(result.data.scheduledGate).toBeNull();
  });

  it("reports that the promoter is release-managed", async () => {
    expect(await call("repair_promoter_image")).toMatchObject({
      success: true,
      data: { supported: true, targetKind: "release-artifact", repairMode: "release-managed" },
    });
  });
});
