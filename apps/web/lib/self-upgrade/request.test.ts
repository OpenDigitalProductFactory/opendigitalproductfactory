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
  healthTarget: 100,
  maintenanceWindows: [],
  sourceMode: "upstream" as const,
  installBranch: "dpf/install",
  useIsolatedWorkspace: true,
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
      message: "queue-dispatch-failed: inngest offline",
    });
    expect(mocks.failRun).toHaveBeenCalledWith(
      "SUR-QUEUED1",
      "queue-dispatch-failed: inngest offline",
    );
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
      },
    });
    expect(mocks.inngestSend.mock.calls[0]?.[0].data.force).toBeUndefined();
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
