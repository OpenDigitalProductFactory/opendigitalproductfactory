import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inngestSend: vi.fn(),
  getSelfUpgradeConfig: vi.fn(),
  resolveOperatingScheduleForSystem: vi.fn(),
  resolveAutoUpgradeWindow: vi.fn(),
  isUpgradeWindowOpen: vi.fn(),
  getLatestRun: vi.fn(),
  createRun: vi.fn(),
  failRun: vi.fn(),
  resolveReleaseBatchStatus: vi.fn(),
  readSelfUpgradeSupport: vi.fn(),
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: {
    send: mocks.inngestSend,
  },
}));

vi.mock("@/lib/queue/functions/self-upgrade", () => ({
  SELF_UPGRADE_EVENT: "ops/self-upgrade.run",
}));

vi.mock("@/lib/self-upgrade/config", () => ({
  getSelfUpgradeConfig: mocks.getSelfUpgradeConfig,
}));

vi.mock("@/lib/operating-hours-read", () => ({
  resolveOperatingScheduleForSystem: mocks.resolveOperatingScheduleForSystem,
}));

vi.mock("@/lib/self-upgrade/auto-window", () => ({
  resolveAutoUpgradeWindow: mocks.resolveAutoUpgradeWindow,
}));

vi.mock("@/lib/self-upgrade/window", () => ({
  isUpgradeWindowOpen: mocks.isUpgradeWindowOpen,
}));

vi.mock("@/lib/self-upgrade/release-batch-status", () => ({
  resolveReleaseBatchStatus: mocks.resolveReleaseBatchStatus,
}));

vi.mock("@/lib/self-upgrade/support", () => ({
  readSelfUpgradeSupport: mocks.readSelfUpgradeSupport,
}));

vi.mock("@/lib/self-upgrade/run-store", () => ({
  getLatestRun: mocks.getLatestRun,
  createRun: mocks.createRun,
  failRun: mocks.failRun,
}));

import { requestSelfUpgrade } from "./request";

const CONFIG = {
  enabled: true,
  channel: "stable",
  checkIntervalHours: 24,
  cooldownMinutes: 30,
  batchMinPendingPrs: 10,
  batchMaxWaitHours: 168,
  healthTarget: 100,
  maintenanceWindows: [],
  sourceMode: "upstream" as const,
  installBranch: "dpf/install",
  useIsolatedWorkspace: true,
};

/** A release-batch status that lets the request through (eligible). */
const BATCH_ELIGIBLE = {
  applicable: true,
  eligible: true,
  reason: "threshold-met",
  pendingCount: 12,
  minPendingPrs: 10,
  maxWaitHours: 168,
  oldestPendingAt: null,
  lineageSha: "lineage-sha",
  summary: "12 merged updates accumulated (threshold 10) — the batch is ready to deploy.",
};

const SCHEDULE = {
  sunday: { enabled: false, open: "09:00", close: "17:00" },
  monday: { enabled: true, open: "09:00", close: "17:00" },
  tuesday: { enabled: true, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "09:00", close: "17:00" },
  thursday: { enabled: true, open: "09:00", close: "17:00" },
  friday: { enabled: true, open: "09:00", close: "17:00" },
  saturday: { enabled: false, open: "09:00", close: "17:00" },
};

describe("requestSelfUpgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(CONFIG);
    mocks.resolveOperatingScheduleForSystem.mockResolvedValue({
      schedule: SCHEDULE,
      timezone: "America/Chicago",
      timezoneKnown: true,
      lowTrafficWindows: [],
    });
    mocks.resolveAutoUpgradeWindow.mockReturnValue({ kind: "operating-hours" });
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-QUEUED1", status: "queued" });
    mocks.inngestSend.mockResolvedValue({ ids: ["evt-1"] });
    mocks.failRun.mockResolvedValue({});
    mocks.resolveReleaseBatchStatus.mockResolvedValue(BATCH_ELIGIBLE);
    mocks.readSelfUpgradeSupport.mockResolvedValue({
      configuredEnabled: true,
      supported: true,
      enabled: true,
      targetKind: "git-source",
      reason: "enabled",
      message: null,
    });
  });

  it("queues the same event as the human action in manual mode", async () => {
    const result = await requestSelfUpgrade({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });

    expect(result).toMatchObject({
      success: true,
      status: "queued",
      runId: "SUR-QUEUED1",
      triggeredBy: "manual:user-ops-1",
      eventIds: ["evt-1"],
    });
    expect(mocks.createRun).toHaveBeenCalledWith({ triggeredBy: "manual:user-ops-1" });
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "ops/self-upgrade.run",
      data: {
        runId: "SUR-QUEUED1",
        triggeredBy: "manual:user-ops-1",
      },
    });
    expect(mocks.isUpgradeWindowOpen).not.toHaveBeenCalled();
  });

  it("queues an artifact-native upgrade on a consumer release install", async () => {
    mocks.readSelfUpgradeSupport.mockResolvedValue({
      configuredEnabled: true,
      supported: true,
      enabled: true,
      targetKind: "release-artifact",
      reason: "enabled",
      message: null,
    });

    const result = await requestSelfUpgrade({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });

    expect(result).toMatchObject({
      success: true,
      status: "queued",
      runId: "SUR-QUEUED1",
    });
    expect(mocks.createRun).toHaveBeenCalled();
    expect(mocks.inngestSend).toHaveBeenCalled();
  });

  it.each(["running", "queued", "pending"])(
    "does not dispatch a duplicate event when latest run is %s",
    async (status) => {
      mocks.getLatestRun.mockResolvedValue({ runId: "SUR-ACTIVE1", status });

      const result = await requestSelfUpgrade({
        requestedBy: "mcp:codex",
        actorKind: "agent",
      });

      expect(result).toMatchObject({
        success: true,
        status: "already_active",
        runId: "SUR-ACTIVE1",
      });
      expect(mocks.createRun).not.toHaveBeenCalled();
      expect(mocks.inngestSend).not.toHaveBeenCalled();
    },
  );

  it("marks the queued run failed when event dispatch fails", async () => {
    mocks.inngestSend.mockRejectedValueOnce(new Error("inngest offline"));

    const result = await requestSelfUpgrade({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });

    expect(result).toMatchObject({
      success: false,
      status: "dispatch_failed",
      runId: "SUR-QUEUED1",
    });
    // A non-transport error is not retried, and the message must say so rather
    // than implying three exhausted attempts.
    expect(result).toHaveProperty("message", expect.stringContaining("inngest offline"));
    expect(result).toHaveProperty("message", expect.stringContaining("after 1 attempt"));
    expect(mocks.inngestSend).toHaveBeenCalledTimes(1);
    expect(mocks.failRun).toHaveBeenCalledWith(
      "SUR-QUEUED1",
      expect.stringContaining("queue-dispatch-failed: inngest offline"),
    );
  });

  it("survives a transient connect timeout instead of failing the run", async () => {
    // SUR-D71E8971: one lost connect race against a 10s timeout marked the run
    // permanently failed while inngest was up and processing events throughout.
    const timeout = new TypeError("fetch failed");
    (timeout as { cause?: unknown }).cause = Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    mocks.inngestSend
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ ids: ["evt-retry"] });

    const result = await requestSelfUpgrade({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });

    expect(result).toMatchObject({
      success: true,
      status: "queued",
      runId: "SUR-QUEUED1",
      eventIds: ["evt-retry"],
    });
    expect(mocks.inngestSend).toHaveBeenCalledTimes(2);
    expect(mocks.failRun).not.toHaveBeenCalled();
  });

  it("requires human override when an agent requests outside the effective window", async () => {
    mocks.isUpgradeWindowOpen.mockReturnValue(false);

    const result = await requestSelfUpgrade({
      requestedBy: "mcp:codex",
      actorKind: "agent",
    });

    expect(result).toMatchObject({
      success: true,
      status: "human_override_required",
      reason: "outside-window",
    });
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("allows an agent request inside the effective window without force", async () => {
    const result = await requestSelfUpgrade({
      requestedBy: "mcp:codex",
      actorKind: "agent",
    });

    expect(result).toMatchObject({
      success: true,
      status: "queued",
      runId: "SUR-QUEUED1",
      triggeredBy: "mcp:codex",
    });
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "ops/self-upgrade.run",
      data: {
        runId: "SUR-QUEUED1",
        triggeredBy: "mcp:codex",
        routine: true,
      },
    });
    expect(mocks.inngestSend.mock.calls[0]?.[0].data.force).toBeUndefined();
  });

  it("returns batch_below_threshold with the tally when an agent request is under the batch size", async () => {
    mocks.resolveReleaseBatchStatus.mockResolvedValue({
      applicable: true,
      eligible: false,
      reason: "below-threshold",
      pendingCount: 3,
      minPendingPrs: 10,
      maxWaitHours: 168,
      oldestPendingAt: new Date("2026-07-05T00:00:00.000Z"),
      lineageSha: "lineage-sha",
      summary: "3 of 10 merged updates accumulated — routine upgrades deploy in batches.",
    });

    const result = await requestSelfUpgrade({
      requestedBy: "mcp:codex",
      actorKind: "agent",
    });

    expect(result).toMatchObject({
      success: true,
      status: "batch_below_threshold",
      pendingPrCount: 3,
      batchMinPendingPrs: 10,
      batchMaxWaitHours: 168,
      oldestPendingAt: "2026-07-05T00:00:00.000Z",
    });
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("does not batch-gate a human/manual request", async () => {
    mocks.resolveReleaseBatchStatus.mockResolvedValue({
      applicable: true,
      eligible: false,
      reason: "below-threshold",
      pendingCount: 1,
      minPendingPrs: 10,
      maxWaitHours: 168,
      oldestPendingAt: null,
      lineageSha: "lineage-sha",
      summary: "1 of 10 merged updates accumulated.",
    });

    const result = await requestSelfUpgrade({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });

    expect(result).toMatchObject({ success: true, status: "queued" });
    expect(mocks.resolveReleaseBatchStatus).not.toHaveBeenCalled();
    expect(mocks.inngestSend).toHaveBeenCalled();
  });

  it("requires human override when a 24/7 install has no known timezone", async () => {
    mocks.resolveAutoUpgradeWindow.mockReturnValue({ kind: "needs-timezone" });

    const result = await requestSelfUpgrade({
      requestedBy: "mcp:codex",
      actorKind: "agent",
    });

    expect(result).toMatchObject({
      success: true,
      status: "human_override_required",
      reason: "no-window-needs-timezone",
    });
    expect(mocks.isUpgradeWindowOpen).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
});
