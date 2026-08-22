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
  supported: false,
  enabled: false,
  targetKind: "release-artifact",
  reason: "consumer-release-upgrade-unsupported",
  message: "Automatic updates aren’t available for this install yet.",
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
      eligible: false,
      reason: support.reason,
      pendingCount: null,
      minPendingPrs: 10,
      maxWaitHours: 168,
      oldestPendingAt: null,
      lineageSha: null,
      summary: support.message,
      support,
    });
    mocks.getLatestRun.mockResolvedValue(null);
  });

  it("returns an honest no-dispatch result", async () => {
    mocks.requestSelfUpgrade.mockResolvedValue({
      success: true,
      status: "unsupported_install_mode",
      reason: support.reason,
      targetKind: support.targetKind,
      message: support.message,
    });
    expect(await call("request_self_upgrade")).toMatchObject({
      success: true,
      data: { status: "unsupported_install_mode", reason: support.reason },
    });
  });

  it("reports effectively disabled and ineligible", async () => {
    expect(await call("get_self_upgrade_queue_status")).toMatchObject({
      success: true,
      data: { supported: false, enabled: false, routineUpgradeEligible: false },
    });
  });

  it("does not offer source-promoter repair", async () => {
    expect(await call("repair_promoter_image")).toMatchObject({
      success: true,
      data: { supported: false, targetKind: "release-artifact" },
    });
  });
});
