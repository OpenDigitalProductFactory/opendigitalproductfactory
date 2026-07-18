import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SELF_UPGRADE_CONFIG_KEY,
  parseSelfUpgradeConfig,
  getSelfUpgradeConfig,
  isInMaintenanceWindow,
  nextMaintenanceWindowStart,
} from "./config";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
const mockFindUnique = vi.mocked(prisma.platformConfig.findUnique);

describe("parseSelfUpgradeConfig", () => {
  it("parses protocol readiness disclosure without inferring legacy validation", () => {
    expect(parseSelfUpgradeConfig({
      readinessMode: "legacy-bootstrap",
      readinessOwner: "unavailable",
      callerProtocolVersion: 1,
    })).toMatchObject({
      readinessMode: "legacy-bootstrap",
      readinessOwner: "unavailable",
      callerProtocolVersion: 1,
    });
    expect(parseSelfUpgradeConfig({
      readinessMode: "unknown",
      readinessOwner: "candidate",
      callerProtocolVersion: 0,
    })).not.toMatchObject({ readinessMode: expect.anything(), readinessOwner: expect.anything(), callerProtocolVersion: expect.anything() });
  });

  it("returns disabled defaults when raw is null (missing config)", () => {
    expect(parseSelfUpgradeConfig(null)).toEqual({
      enabled: false,
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
    });
  });

  it("returns disabled defaults when raw is undefined", () => {
    expect(parseSelfUpgradeConfig(undefined)).toEqual({
      enabled: false,
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
    });
  });

  it("returns disabled defaults when raw is a non-object scalar (malformed)", () => {
    expect(parseSelfUpgradeConfig("bad")).toEqual({
      enabled: false,
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
    });
    expect(parseSelfUpgradeConfig(42)).toEqual({
      enabled: false,
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
    });
  });

  it("returns disabled defaults when raw is an empty object (partial malformed)", () => {
    const cfg = parseSelfUpgradeConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.channel).toBe("stable");
    expect(cfg.checkIntervalHours).toBe(24);
    expect(cfg.maintenanceWindows).toEqual([]);
  });

  it("parses a fully-specified enabled config", () => {
    const cfg = parseSelfUpgradeConfig({
      enabled: true,
      channel: "beta",
      checkIntervalHours: 12,
      hostInstallPath: "D:\\DPF",
      hostSourceMountPath: "/host-dpf",
      composeProject: "dpf",
      portalContainerName: "dpf-portal-1",
      dbContainerName: "dpf-postgres-1",
      repositoryRemote: "origin",
      repositoryBranch: "main",
      healthUrl: "http://localhost:3000/api/health",
      promoterImage: "dpf-promoter",
      maintenanceWindows: [],
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.channel).toBe("beta");
    expect(cfg.checkIntervalHours).toBe(12);
    expect(cfg.hostInstallPath).toBe("D:\\DPF");
    expect(cfg.hostSourceMountPath).toBe("/host-dpf");
    expect(cfg.composeProject).toBe("dpf");
    expect(cfg.portalContainerName).toBe("dpf-portal-1");
    expect(cfg.dbContainerName).toBe("dpf-postgres-1");
    expect(cfg.repositoryRemote).toBe("origin");
    expect(cfg.repositoryBranch).toBe("main");
    expect(cfg.healthUrl).toBe("http://localhost:3000/api/health");
    expect(cfg.promoterImage).toBe("dpf-promoter");
  });

  it("parses the seeded disabled config", () => {
    const cfg = parseSelfUpgradeConfig({
      enabled: false,
      channel: "stable",
      checkIntervalHours: 24,
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.channel).toBe("stable");
    expect(cfg.checkIntervalHours).toBe(24);
  });

  // BI-A8A7CCFD — isolated upgrade workspace config surface
  it("defaults useIsolatedWorkspace to true (default-on isolation)", () => {
    expect(parseSelfUpgradeConfig({}).useIsolatedWorkspace).toBe(true);
    expect(parseSelfUpgradeConfig(null).useIsolatedWorkspace).toBe(true);
  });

  it("forces useIsolatedWorkspace true even when explicitly disabled (legacy direct-merge retired, BI-4043A64B)", () => {
    // The legacy direct-merge the false value once selected mutated the host
    // clone's working tree and corrupted it (721 files lost, 2026-06-15). The
    // opt-out is retired: a stored false is no longer honored.
    const cfg = parseSelfUpgradeConfig({ useIsolatedWorkspace: false });
    expect(cfg.useIsolatedWorkspace).toBe(true);
  });

  it("forces useIsolatedWorkspace true for any stored value (boolean or malformed)", () => {
    expect(parseSelfUpgradeConfig({ useIsolatedWorkspace: "yes" }).useIsolatedWorkspace).toBe(true);
    expect(parseSelfUpgradeConfig({ useIsolatedWorkspace: 1 }).useIsolatedWorkspace).toBe(true);
  });

  it("accepts explicit workspace path overrides for in-container and host", () => {
    const cfg = parseSelfUpgradeConfig({
      upgradeWorkspaceMountPath: "/host-dpf/.custom-workspace",
      upgradeWorkspaceHostPath: "/Users/op/dpf/.custom-workspace",
    });
    expect(cfg.upgradeWorkspaceMountPath).toBe("/host-dpf/.custom-workspace");
    expect(cfg.upgradeWorkspaceHostPath).toBe("/Users/op/dpf/.custom-workspace");
  });

  it("falls back to default channel when channel is empty string (malformed)", () => {
    expect(parseSelfUpgradeConfig({ channel: "" }).channel).toBe("stable");
  });

  it("falls back to default channel when channel is non-string (malformed)", () => {
    expect(parseSelfUpgradeConfig({ channel: 5 }).channel).toBe("stable");
  });

  it("falls back to default checkIntervalHours when value is 0 (malformed)", () => {
    expect(parseSelfUpgradeConfig({ checkIntervalHours: 0 }).checkIntervalHours).toBe(24);
  });

  it("falls back to default checkIntervalHours when value is negative (malformed)", () => {
    expect(parseSelfUpgradeConfig({ checkIntervalHours: -5 }).checkIntervalHours).toBe(24);
  });

  it("falls back to default checkIntervalHours when value is non-numeric (malformed)", () => {
    expect(parseSelfUpgradeConfig({ checkIntervalHours: "12" }).checkIntervalHours).toBe(24);
  });

  it("falls back to default enabled when value is non-boolean (malformed)", () => {
    expect(parseSelfUpgradeConfig({ enabled: "yes" }).enabled).toBe(false);
    expect(parseSelfUpgradeConfig({ enabled: 1 }).enabled).toBe(false);
    expect(parseSelfUpgradeConfig({ enabled: "true" }).enabled).toBe(false);
  });

  describe("healthTarget", () => {
    it("defaults to 100 when missing", () => {
      expect(parseSelfUpgradeConfig({}).healthTarget).toBe(100);
    });

    it("accepts a valid health target between 0 and 100", () => {
      expect(parseSelfUpgradeConfig({ healthTarget: 80 }).healthTarget).toBe(80);
      expect(parseSelfUpgradeConfig({ healthTarget: 0 }).healthTarget).toBe(0);
      expect(parseSelfUpgradeConfig({ healthTarget: 100 }).healthTarget).toBe(100);
    });

    it("falls back to 100 when healthTarget is above 100 (out of range)", () => {
      expect(parseSelfUpgradeConfig({ healthTarget: 101 }).healthTarget).toBe(100);
    });

    it("falls back to 100 when healthTarget is negative (out of range)", () => {
      expect(parseSelfUpgradeConfig({ healthTarget: -1 }).healthTarget).toBe(100);
    });

    it("falls back to 100 when healthTarget is non-numeric (malformed)", () => {
      expect(parseSelfUpgradeConfig({ healthTarget: "80" }).healthTarget).toBe(100);
      expect(parseSelfUpgradeConfig({ healthTarget: null }).healthTarget).toBe(100);
    });
  });

  describe("maintenanceWindows", () => {
    it("returns empty array when maintenanceWindows is missing", () => {
      expect(parseSelfUpgradeConfig({}).maintenanceWindows).toEqual([]);
    });

    it("returns empty array when maintenanceWindows is not an array (malformed)", () => {
      expect(parseSelfUpgradeConfig({ maintenanceWindows: "bad" }).maintenanceWindows).toEqual([]);
      expect(parseSelfUpgradeConfig({ maintenanceWindows: {} }).maintenanceWindows).toEqual([]);
      expect(parseSelfUpgradeConfig({ maintenanceWindows: null }).maintenanceWindows).toEqual([]);
    });

    it("accepts valid maintenance windows", () => {
      const cfg = parseSelfUpgradeConfig({
        maintenanceWindows: [{ dayOfWeek: [6, 0], startTime: "02:00", endTime: "04:00" }],
      });
      expect(cfg.maintenanceWindows).toHaveLength(1);
      expect(cfg.maintenanceWindows[0]).toEqual({
        dayOfWeek: [6, 0],
        startTime: "02:00",
        endTime: "04:00",
      });
    });

    it("filters out entries missing dayOfWeek (malformed)", () => {
      const cfg = parseSelfUpgradeConfig({
        maintenanceWindows: [
          { dayOfWeek: [1], startTime: "02:00", endTime: "04:00" },
          { startTime: "02:00", endTime: "04:00" },
        ],
      });
      expect(cfg.maintenanceWindows).toHaveLength(1);
    });

    it("filters out entries with bad time format (malformed)", () => {
      const cfg = parseSelfUpgradeConfig({
        maintenanceWindows: [
          { dayOfWeek: [1], startTime: "02:00", endTime: "04:00" },
          { dayOfWeek: [1], startTime: "2am", endTime: "4am" },
          { dayOfWeek: [1], startTime: "2:00", endTime: "4:00" },
        ],
      });
      expect(cfg.maintenanceWindows).toHaveLength(1);
    });

    it("filters out entries with null or non-object values", () => {
      const cfg = parseSelfUpgradeConfig({
        maintenanceWindows: [
          { dayOfWeek: [1], startTime: "02:00", endTime: "04:00" },
          null,
          "bad",
          42,
        ],
      });
      expect(cfg.maintenanceWindows).toHaveLength(1);
    });

    it("filters out windows with out-of-range dayOfWeek values (0-6 only)", () => {
      const cfg = parseSelfUpgradeConfig({
        maintenanceWindows: [
          { dayOfWeek: [7], startTime: "02:00", endTime: "04:00" },
          { dayOfWeek: [-1], startTime: "02:00", endTime: "04:00" },
        ],
      });
      expect(cfg.maintenanceWindows).toHaveLength(0);
    });

    it("accepts multiple valid windows", () => {
      const cfg = parseSelfUpgradeConfig({
        maintenanceWindows: [
          { dayOfWeek: [6], startTime: "02:00", endTime: "06:00" },
          { dayOfWeek: [0], startTime: "03:00", endTime: "05:00" },
        ],
      });
      expect(cfg.maintenanceWindows).toHaveLength(2);
    });
  });
});

describe("isInMaintenanceWindow", () => {
  // Jan 5 2026 = Monday (day 1), Jan 6 = Tuesday (day 2)
  const MONDAY_3AM = new Date(2026, 0, 5, 3, 0);
  const MONDAY_5AM = new Date(2026, 0, 5, 5, 0);
  const TUESDAY_3AM = new Date(2026, 0, 6, 3, 0);
  const MONDAY_23PM = new Date(2026, 0, 5, 23, 0);

  it("returns false when no windows are configured", () => {
    const cfg = parseSelfUpgradeConfig({ maintenanceWindows: [] });
    expect(isInMaintenanceWindow(cfg, MONDAY_3AM)).toBe(false);
  });

  it("returns false when maintenanceWindows defaults to empty (missing from config)", () => {
    const cfg = parseSelfUpgradeConfig({});
    expect(isInMaintenanceWindow(cfg, MONDAY_3AM)).toBe(false);
  });

  it("returns true when now is inside a configured window", () => {
    const cfg = parseSelfUpgradeConfig({
      maintenanceWindows: [{ dayOfWeek: [1], startTime: "02:00", endTime: "04:00" }],
    });
    expect(isInMaintenanceWindow(cfg, MONDAY_3AM)).toBe(true);
  });

  it("returns false when now is outside the window time range", () => {
    const cfg = parseSelfUpgradeConfig({
      maintenanceWindows: [{ dayOfWeek: [1], startTime: "02:00", endTime: "04:00" }],
    });
    expect(isInMaintenanceWindow(cfg, MONDAY_5AM)).toBe(false);
  });

  it("returns false when now is on the wrong day", () => {
    const cfg = parseSelfUpgradeConfig({
      maintenanceWindows: [{ dayOfWeek: [1], startTime: "02:00", endTime: "04:00" }],
    });
    expect(isInMaintenanceWindow(cfg, TUESDAY_3AM)).toBe(false);
  });

  it("returns true for overnight window (startTime > endTime) when now is after start", () => {
    const cfg = parseSelfUpgradeConfig({
      maintenanceWindows: [{ dayOfWeek: [1], startTime: "22:00", endTime: "06:00" }],
    });
    expect(isInMaintenanceWindow(cfg, MONDAY_23PM)).toBe(true);
  });

  it("handles overnight window spanning two days when both days are in dayOfWeek", () => {
    const cfg = parseSelfUpgradeConfig({
      maintenanceWindows: [{ dayOfWeek: [1, 2], startTime: "22:00", endTime: "06:00" }],
    });
    const TUESDAY_1AM = new Date(2026, 0, 6, 1, 0);
    expect(isInMaintenanceWindow(cfg, TUESDAY_1AM)).toBe(true);
  });

  it("evaluates day and time in local timezone (new Date(y,m,d,h) constructs local time)", () => {
    // new Date(year, month, day, hour, minute) creates a date in local time.
    // isInWindow uses getDay()/getHours() which also read local time, so they agree.
    const cfg = parseSelfUpgradeConfig({
      maintenanceWindows: [{ dayOfWeek: [1], startTime: "03:00", endTime: "04:00" }],
    });
    const localMonday3_30am = new Date(2026, 0, 5, 3, 30);
    expect(isInMaintenanceWindow(cfg, localMonday3_30am)).toBe(true);
  });

  it("returns true when now matches the second of multiple windows", () => {
    const cfg = parseSelfUpgradeConfig({
      maintenanceWindows: [
        { dayOfWeek: [6], startTime: "02:00", endTime: "04:00" }, // Saturday
        { dayOfWeek: [1], startTime: "02:00", endTime: "04:00" }, // Monday
      ],
    });
    expect(isInMaintenanceWindow(cfg, MONDAY_3AM)).toBe(true);
  });

  it("evaluates the window in the provided store timezone, not the host clock", () => {
    // 08:00 UTC Monday = 03:00 Monday in US Central (CDT, -5). A 02:00–04:00
    // Monday window is active in Central but NOT against the UTC host clock.
    const cfg = parseSelfUpgradeConfig({
      maintenanceWindows: [{ dayOfWeek: [1], startTime: "02:00", endTime: "04:00" }],
    });
    const mon0800Utc = new Date("2026-05-25T08:00:00Z");
    expect(isInMaintenanceWindow(cfg, mon0800Utc, "America/Chicago")).toBe(true);
    expect(isInMaintenanceWindow(cfg, mon0800Utc, "UTC")).toBe(false);
  });
});

describe("getSelfUpgradeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns disabled defaults when no DB row exists (missing config)", async () => {
    mockFindUnique.mockResolvedValue(null);
    const cfg = await getSelfUpgradeConfig();
    expect(cfg).toEqual({
      enabled: false,
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
    });
  });

  it("queries the seeded self_upgrade key", async () => {
    mockFindUnique.mockResolvedValue(null);
    await getSelfUpgradeConfig();
    expect(SELF_UPGRADE_CONFIG_KEY).toBe("self_upgrade");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: "self_upgrade" } });
  });

  it("falls back to the legacy portal.selfUpgrade key when the seeded key is absent", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "legacy",
        key: "portal.selfUpgrade",
        value: { enabled: true, channel: "beta", checkIntervalHours: 6 },
        updatedAt: new Date(),
      });

    const cfg = await getSelfUpgradeConfig();

    expect(cfg.enabled).toBe(true);
    expect(cfg.channel).toBe("beta");
    expect(mockFindUnique).toHaveBeenNthCalledWith(1, { where: { key: "self_upgrade" } });
    expect(mockFindUnique).toHaveBeenNthCalledWith(2, { where: { key: "portal.selfUpgrade" } });
  });

  it("parses the seeded disabled config correctly", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "self_upgrade",
      value: { enabled: false, channel: "stable", checkIntervalHours: 24 },
      updatedAt: new Date(),
    });
    const cfg = await getSelfUpgradeConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.channel).toBe("stable");
    expect(cfg.checkIntervalHours).toBe(24);
  });

  it("returns enabled config when explicitly enabled in DB", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "self_upgrade",
      value: { enabled: true, channel: "beta", checkIntervalHours: 6 },
      updatedAt: new Date(),
    });
    const cfg = await getSelfUpgradeConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.channel).toBe("beta");
    expect(cfg.checkIntervalHours).toBe(6);
  });

  it("handles malformed DB value gracefully", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "self_upgrade",
      value: "corrupted" as unknown as object,
      updatedAt: new Date(),
    });
    const cfg = await getSelfUpgradeConfig();
    expect(cfg.enabled).toBe(false);
  });
});

describe("nextMaintenanceWindowStart", () => {
  const base = {
    enabled: true,
    channel: "stable",
    checkIntervalHours: 24,
    cooldownMinutes: 30,
    batchMinPendingPrs: 10,
    batchMaxWaitHours: 168,
    healthTarget: 100,
    sourceMode: "upstream" as const,
    installBranch: "dpf/install",
    useIsolatedWorkspace: true,
  };

  it("returns null when no windows are configured", () => {
    expect(
      nextMaintenanceWindowStart({ ...base, maintenanceWindows: [] }),
    ).toBeNull();
  });

  it("returns `now` when a window is currently active", () => {
    // 03:00 local, inside a 02:00-04:00 window on the same weekday.
    const now = new Date(2026, 4, 25, 3, 0, 0, 0);
    const config = {
      ...base,
      maintenanceWindows: [
        { dayOfWeek: [now.getDay()], startTime: "02:00", endTime: "04:00" },
      ],
    };
    expect(nextMaintenanceWindowStart(config, now)).toBe(now);
  });

  it("returns the next start time later today when before the window", () => {
    // 01:00 local, window opens at 02:00 the same day.
    const now = new Date(2026, 4, 25, 1, 0, 0, 0);
    const config = {
      ...base,
      maintenanceWindows: [
        { dayOfWeek: [now.getDay()], startTime: "02:00", endTime: "04:00" },
      ],
    };
    const expected = new Date(2026, 4, 25, 2, 0, 0, 0);
    expect(nextMaintenanceWindowStart(config, now)?.getTime()).toBe(
      expected.getTime(),
    );
  });

  it("projects the next window start in the store timezone", () => {
    // Monday 06:00 UTC = Monday 01:00 US Central — before a 02:00 Central window.
    // The next start is 02:00 Central = 07:00 UTC, regardless of the host clock.
    const now = new Date("2026-05-25T06:00:00Z");
    const config = {
      ...base,
      maintenanceWindows: [{ dayOfWeek: [1], startTime: "02:00", endTime: "04:00" }],
    };
    expect(
      nextMaintenanceWindowStart(config, now, "America/Chicago")?.toISOString(),
    ).toBe("2026-05-25T07:00:00.000Z");
  });
});
