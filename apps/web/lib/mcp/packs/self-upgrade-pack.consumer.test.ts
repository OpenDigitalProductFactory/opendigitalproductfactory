import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSelfUpgrade: vi.fn(),
  getSelfUpgradeConfig: vi.fn(),
  readSelfUpgradeSupport: vi.fn(),
  resolveReleaseBatchStatus: vi.fn(),
  getLatestRun: vi.fn(),
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
      data: { supported: true, enabled: true, routineUpgradeEligible: true },
    });
  });

  it("reports that the promoter is release-managed", async () => {
    expect(await call("repair_promoter_image")).toMatchObject({
      success: true,
      data: { supported: true, targetKind: "release-artifact", repairMode: "release-managed" },
    });
  });
});
