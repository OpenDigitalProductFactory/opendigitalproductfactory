import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSelfUpgradeConfig: vi.fn(),
  getLatestSucceededRun: vi.fn(),
  defaultGitRunner: vi.fn(),
  readSelfUpgradeSupport: vi.fn(),
}));

vi.mock("./config", () => ({
  getSelfUpgradeConfig: mocks.getSelfUpgradeConfig,
}));
vi.mock("./run-store", () => ({
  getLatestSucceededRun: mocks.getLatestSucceededRun,
}));
vi.mock("./prepare-source", () => ({
  defaultGitRunner: mocks.defaultGitRunner,
}));
vi.mock("./support", () => ({
  readSelfUpgradeSupport: mocks.readSelfUpgradeSupport,
}));

import { resolveReleaseBatchStatus } from "./release-batch-status";
import type { SelfUpgradeConfig } from "./config";

const CONFIG: SelfUpgradeConfig = {
  enabled: true,
  channel: "stable",
  checkIntervalHours: 24,
  cooldownMinutes: 30,
  batchMinPendingPrs: 10,
  batchMaxWaitHours: 168,
  healthTarget: 100,
  maintenanceWindows: [],
  sourceMode: "upstream",
  installBranch: "dpf/install",
  useIsolatedWorkspace: true,
  hostSourceMountPath: "/host-dpf",
  repositoryRemote: "origin",
  repositoryBranch: "main",
};

describe("resolveReleaseBatchStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(CONFIG);
    mocks.getLatestSucceededRun.mockResolvedValue({ targetSha: "lineage-sha" });
    mocks.readSelfUpgradeSupport.mockResolvedValue({
      configuredEnabled: true,
      supported: true,
      enabled: true,
      targetKind: "git-source",
      reason: "enabled",
      message: null,
    });
    mocks.defaultGitRunner.mockImplementation(async (args: string[]) =>
      args.includes("log")
        ? { stdout: "1700000000\n1700000100\n", stderr: "", code: 0 }
        : { stdout: "", stderr: "", code: 0 },
    );
  });

  it("reports the pending tally and a below-threshold decision", async () => {
    // `now` near the mocked commit epochs so the max-wait valve does not fire.
    const status = await resolveReleaseBatchStatus({
      config: CONFIG,
      now: new Date(1700000200 * 1000),
    });
    expect(status.applicable).toBe(true);
    expect(status.pendingCount).toBe(2);
    expect(status.eligible).toBe(false);
    expect(status.reason).toBe("below-threshold");
    expect(status.summary).toContain("2 of 10");
  });

  it("does no Git or lineage work for an unsupported consumer release", async () => {
    mocks.readSelfUpgradeSupport.mockResolvedValue({
      configuredEnabled: true,
      supported: false,
      enabled: false,
      targetKind: "release-artifact",
      reason: "consumer-release-upgrade-unsupported",
      message: "Automatic updates aren’t available for this install yet.",
    });

    const status = await resolveReleaseBatchStatus({ config: CONFIG, fresh: true });

    expect(status).toMatchObject({
      applicable: false,
      eligible: false,
      reason: "consumer-release-upgrade-unsupported",
      pendingCount: null,
      lineageSha: null,
      summary: "Automatic updates aren’t available for this install yet.",
      support: { supported: false, targetKind: "release-artifact" },
    });
    expect(mocks.getLatestSucceededRun).not.toHaveBeenCalled();
    expect(mocks.defaultGitRunner).not.toHaveBeenCalled();
  });

  it("fetches first when fresh:true is requested", async () => {
    await resolveReleaseBatchStatus({ config: CONFIG, fresh: true });
    const calledFetch = mocks.defaultGitRunner.mock.calls.some((c) =>
      (c[0] as string[]).includes("fetch"),
    );
    expect(calledFetch).toBe(true);
  });

  it("does not fetch when fresh is falsy", async () => {
    await resolveReleaseBatchStatus({ config: CONFIG });
    const calledFetch = mocks.defaultGitRunner.mock.calls.some((c) =>
      (c[0] as string[]).includes("fetch"),
    );
    expect(calledFetch).toBe(false);
  });

  it("is not applicable in local source mode", async () => {
    const status = await resolveReleaseBatchStatus({
      config: { ...CONFIG, sourceMode: "local" as const },
    });
    expect(status.applicable).toBe(false);
    expect(status.eligible).toBe(true);
    expect(mocks.defaultGitRunner).not.toHaveBeenCalled();
  });

  it("fails open (eligible) when there is no lineage marker yet", async () => {
    mocks.getLatestSucceededRun.mockResolvedValue(null);
    const status = await resolveReleaseBatchStatus({ config: CONFIG });
    expect(status.lineageSha).toBeNull();
    expect(status.pendingCount).toBeNull();
    expect(status.eligible).toBe(true);
  });
});
