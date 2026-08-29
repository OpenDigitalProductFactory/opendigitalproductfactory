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
  resolveCurrentSelfUpgradeTarget: vi.fn(),
  admitSelfUpgrade: vi.fn(),
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
vi.mock("@/lib/self-upgrade/admission", () => ({
  resolveCurrentSelfUpgradeTarget: mocks.resolveCurrentSelfUpgradeTarget,
  admitSelfUpgrade: mocks.admitSelfUpgrade,
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
    mocks.resolveCurrentSelfUpgradeTarget.mockResolvedValue({
      targetKind: "git-source",
      targetSha: "b".repeat(40),
      targetTag: null,
    });
    mocks.admitSelfUpgrade.mockResolvedValue({
      admitted: true,
      disposition: "created",
      runId: "SUR-QUEUED1",
      dispatchStatus: "admission_pending",
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
      eventIds: [],
      dispatchStatus: "admission_pending",
    });
    expect(mocks.admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      triggeredBy: "manual:user-ops-1",
      routine: false,
    }));
    expect(mocks.inngestSend).not.toHaveBeenCalled();
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
    expect(mocks.admitSelfUpgrade).toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("does not grant recovery authority to a plain request after a terminal failure", async () => {
    mocks.getLatestRun.mockResolvedValue({
      runId: "SUR-6B312E24",
      status: "failed",
      targetSha: "04b0b9d84251c2a91ae519bf79eedd86b662f604",
      targetTag: "v2026.08.29-terminal-writer-failed-reader-history.1",
      deployedSha: null,
      completedAt: new Date("2026-08-29T14:45:34.380Z"),
    });
    const result = await requestSelfUpgrade({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });

    expect(result).toMatchObject({
      success: true,
      status: "human_override_required",
      reason: "terminal-recovery-needs-operator-binding",
    });
    expect(mocks.admitSelfUpgrade).not.toHaveBeenCalled();
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

  it("returns the durable admission without waiting for event dispatch", async () => {
    mocks.inngestSend.mockRejectedValueOnce(new Error("inngest offline"));

    const result = await requestSelfUpgrade({
      requestedBy: "manual:user-ops-1",
      actorKind: "human",
    });

    expect(result).toMatchObject({ success: true, status: "queued", runId: "SUR-QUEUED1" });
    expect(mocks.inngestSend).not.toHaveBeenCalled();
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
    expect(mocks.admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      triggeredBy: "mcp:codex",
      routine: true,
      requestedForce: false,
    }));
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
    expect(mocks.admitSelfUpgrade).toHaveBeenCalled();
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
