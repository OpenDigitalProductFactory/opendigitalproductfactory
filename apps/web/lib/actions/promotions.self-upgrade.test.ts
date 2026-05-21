import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    changePromotion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    businessProfile: {
      findFirst: vi.fn(),
    },
    selfUpgradeRun: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: vi.fn(),
  lazyUtil: vi.fn(),
}));

vi.mock("@/lib/self-upgrade", () => ({
  getSelfUpgradeConfig: vi.fn(),
  isInMaintenanceWindow: vi.fn(),
  resolveTargetSha: vi.fn(),
  isShaFresh: vi.fn(),
  getDeployedSha: vi.fn(),
  getLatestRun: vi.fn(),
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import * as SelfUpgrade from "@/lib/self-upgrade";
import { inngest } from "@/lib/queue/inngest-client";
import { getSelfUpgradeStatus, listSelfUpgradeRuns, triggerSelfUpgrade } from "./promotions";

const mockSession = {
  user: {
    id: "user-ops-1",
    email: "ops@test.com",
    platformRole: "OPS-000",
    isSuperuser: false,
  },
};

const mockConfig = {
  enabled: true,
  channel: "stable",
  checkIntervalHours: 24,
  healthTarget: 100,
  maintenanceWindows: [],
};

const mockRun = {
  id: "cuid-1",
  runId: "SUR-AAAA0001",
  status: "succeeded",
  triggeredBy: "scheduled",
  fromVersion: "abc1234",
  toVersion: "def5678",
  startedAt: new Date("2026-05-20T02:00:00Z"),
  completedAt: new Date("2026-05-20T02:05:00Z"),
  error: null,
  log: null,
  createdAt: new Date("2026-05-20T02:00:00Z"),
  updatedAt: new Date("2026-05-20T02:05:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
  vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue(null);
});

// ─── Permission Guard ─────────────────────────────────────────────────────────

describe("getSelfUpgradeStatus – access control", () => {
  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(getSelfUpgradeStatus()).rejects.toThrow("Unauthorized");
  });

  it("rejects users without view_operations permission", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(getSelfUpgradeStatus()).rejects.toThrow("Unauthorized");
  });

  it("checks view_operations permission with user role", async () => {
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(SelfUpgrade.isInMaintenanceWindow).mockReturnValue(false);
    vi.mocked(SelfUpgrade.getDeployedSha).mockReturnValue(null);
    vi.mocked(SelfUpgrade.resolveTargetSha).mockResolvedValue(null);
    vi.mocked(SelfUpgrade.isShaFresh).mockReturnValue(false);
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue(null);

    await getSelfUpgradeStatus();

    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({
        platformRole: mockSession.user.platformRole,
        isSuperuser: mockSession.user.isSuperuser,
      }),
      "view_operations",
    );
  });
});

// ─── getSelfUpgradeStatus ─────────────────────────────────────────────────────

describe("getSelfUpgradeStatus", () => {
  it("returns config fields, window status, sha info, and latest run", async () => {
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(SelfUpgrade.isInMaintenanceWindow).mockReturnValue(true);
    vi.mocked(SelfUpgrade.getDeployedSha).mockReturnValue("abc1234");
    vi.mocked(SelfUpgrade.resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(SelfUpgrade.isShaFresh).mockReturnValue(false);
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue(mockRun as never);

    const result = await getSelfUpgradeStatus();

    expect(result.enabled).toBe(true);
    expect(result.channel).toBe("stable");
    expect(result.inMaintenanceWindow).toBe(true);
    expect(result.deployedSha).toBe("abc1234");
    expect(result.targetSha).toBe("def5678");
    expect(result.isFresh).toBe(false);
    expect(result.latestRun).toEqual(mockRun);
  });

  it("returns isFresh=true when deployed sha matches target", async () => {
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(SelfUpgrade.isInMaintenanceWindow).mockReturnValue(false);
    vi.mocked(SelfUpgrade.getDeployedSha).mockReturnValue("def5678");
    vi.mocked(SelfUpgrade.resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(SelfUpgrade.isShaFresh).mockReturnValue(true);
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.isFresh).toBe(true);
    expect(result.latestRun).toBeNull();
  });

  it("returns isFresh=false and skips isShaFresh when targetSha is null", async () => {
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(SelfUpgrade.isInMaintenanceWindow).mockReturnValue(false);
    vi.mocked(SelfUpgrade.getDeployedSha).mockReturnValue("abc1234");
    vi.mocked(SelfUpgrade.resolveTargetSha).mockResolvedValue(null);
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.isFresh).toBe(false);
    expect(result.targetSha).toBeNull();
    expect(SelfUpgrade.isShaFresh).not.toHaveBeenCalled();
  });

  it("returns disabled status when self-upgrade is disabled", async () => {
    const disabledConfig = { ...mockConfig, enabled: false };
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue(disabledConfig as never);
    vi.mocked(SelfUpgrade.isInMaintenanceWindow).mockReturnValue(false);
    vi.mocked(SelfUpgrade.getDeployedSha).mockReturnValue(null);
    vi.mocked(SelfUpgrade.resolveTargetSha).mockResolvedValue(null);
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.enabled).toBe(false);
  });

  it("passes config to isInMaintenanceWindow", async () => {
    const windowConfig = {
      ...mockConfig,
      maintenanceWindows: [{ dayOfWeek: [2], startTime: "02:00", endTime: "04:00" }],
    };
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue(windowConfig as never);
    vi.mocked(SelfUpgrade.isInMaintenanceWindow).mockReturnValue(false);
    vi.mocked(SelfUpgrade.getDeployedSha).mockReturnValue(null);
    vi.mocked(SelfUpgrade.resolveTargetSha).mockResolvedValue(null);
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue(null);

    await getSelfUpgradeStatus();

    expect(SelfUpgrade.isInMaintenanceWindow).toHaveBeenCalledWith(windowConfig);
  });

  it("passes channel to resolveTargetSha", async () => {
    const betaConfig = { ...mockConfig, channel: "beta" };
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue(betaConfig as never);
    vi.mocked(SelfUpgrade.isInMaintenanceWindow).mockReturnValue(false);
    vi.mocked(SelfUpgrade.getDeployedSha).mockReturnValue(null);
    vi.mocked(SelfUpgrade.resolveTargetSha).mockResolvedValue(null);
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue(null);

    await getSelfUpgradeStatus();

    expect(SelfUpgrade.resolveTargetSha).toHaveBeenCalledWith("beta");
  });
});

// ─── listSelfUpgradeRuns ──────────────────────────────────────────────────────

const mockRunRow1 = {
  runId: "SUR-AAAA0001",
  status: "succeeded",
  triggeredBy: "scheduled",
  fromVersion: "abc1234",
  toVersion: "def5678",
  startedAt: new Date("2026-05-20T02:00:00Z"),
  completedAt: new Date("2026-05-20T02:05:00Z"),
  error: null,
  createdAt: new Date("2026-05-20T02:00:00Z"),
};

const mockRunRow2 = {
  runId: "SUR-BBBB0002",
  status: "failed",
  triggeredBy: "manual",
  fromVersion: "abc1234",
  toVersion: "def5678",
  startedAt: new Date("2026-05-19T02:00:00Z"),
  completedAt: new Date("2026-05-19T02:01:00Z"),
  error: "promoter exited with code 1",
  createdAt: new Date("2026-05-19T02:00:00Z"),
};

describe("listSelfUpgradeRuns – access control", () => {
  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(listSelfUpgradeRuns()).rejects.toThrow("Unauthorized");
  });

  it("rejects users without view_operations permission", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(listSelfUpgradeRuns()).rejects.toThrow("Unauthorized");
  });
});

describe("listSelfUpgradeRuns – pagination", () => {
  it("returns all items and null nextCursor when result is under limit", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [mockRunRow1, mockRunRow2] as never,
    );

    const result = await listSelfUpgradeRuns({ limit: 20 });

    expect(result.runs).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("returns limit items and nextCursor when more items exist", async () => {
    // Return limit+1 rows to signal there is a next page
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [mockRunRow1, mockRunRow2] as never,
    );

    const result = await listSelfUpgradeRuns({ limit: 1 });

    expect(result.runs).toHaveLength(1);
    expect(result.nextCursor).toBe(mockRunRow1.runId);
  });

  it("passes cursor and skip:1 to findMany when cursor is provided", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [mockRunRow2] as never,
    );

    await listSelfUpgradeRuns({ cursor: "SUR-AAAA0001", limit: 20 });

    expect(prisma.selfUpgradeRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { runId: "SUR-AAAA0001" },
        skip: 1,
      }),
    );
  });

  it("omits cursor args when no cursor is provided", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns();

    const call = vi.mocked(prisma.selfUpgradeRun.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("cursor");
    expect(call).not.toHaveProperty("skip");
  });

  it("uses default limit of 20 (take=21) when no limit given", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns();

    expect(prisma.selfUpgradeRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 21 }),
    );
  });

  it("caps limit at 50 (take=51) when a larger limit is requested", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns({ limit: 200 });

    expect(prisma.selfUpgradeRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 }),
    );
  });

  it("orders by createdAt descending", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns();

    expect(prisma.selfUpgradeRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });
});

describe("listSelfUpgradeRuns – DTO shape", () => {
  it("returns expected fields and excludes log", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [mockRunRow1] as never,
    );

    const result = await listSelfUpgradeRuns();
    const run = result.runs[0];

    expect(run.runId).toBe(mockRunRow1.runId);
    expect(run.status).toBe(mockRunRow1.status);
    expect(run.triggeredBy).toBe(mockRunRow1.triggeredBy);
    expect(run.fromVersion).toBe(mockRunRow1.fromVersion);
    expect(run.toVersion).toBe(mockRunRow1.toVersion);
    expect(run.startedAt).toEqual(mockRunRow1.startedAt);
    expect(run.completedAt).toEqual(mockRunRow1.completedAt);
    expect(run.error).toBeNull();
    expect(run.createdAt).toEqual(mockRunRow1.createdAt);
    expect(run).not.toHaveProperty("log");
  });

  it("selects only DTO fields from the database", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns();

    const call = vi.mocked(prisma.selfUpgradeRun.findMany).mock.calls[0][0] as Record<string, unknown>;
    const select = call.select as Record<string, boolean>;
    expect(select.runId).toBe(true);
    expect(select.status).toBe(true);
    expect(select.triggeredBy).toBe(true);
    expect(select.fromVersion).toBe(true);
    expect(select.toVersion).toBe(true);
    expect(select.startedAt).toBe(true);
    expect(select.completedAt).toBe(true);
    expect(select.error).toBe(true);
    expect(select.createdAt).toBe(true);
    expect(select).not.toHaveProperty("log");
  });
});

// ─── triggerSelfUpgrade – access control ─────────────────────────────────────

describe("triggerSelfUpgrade – access control", () => {
  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(triggerSelfUpgrade()).rejects.toThrow("Unauthorized");
  });

  it("rejects users without view_operations permission", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(triggerSelfUpgrade()).rejects.toThrow("Unauthorized");
  });
});

// ─── triggerSelfUpgrade – dispatch ───────────────────────────────────────────

describe("triggerSelfUpgrade – dispatch", () => {
  it("sends self-upgrade event to inngest", async () => {
    await triggerSelfUpgrade();

    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ops/self-upgrade.run" }),
    );
  });

  it("includes manual triggeredBy with user id", async () => {
    await triggerSelfUpgrade();

    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredBy: `manual:${mockSession.user.id}`,
        }),
      }),
    );
  });

  it("passes dryRun: true when dryRun option is set", async () => {
    await triggerSelfUpgrade({ dryRun: true });

    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dryRun: true }),
      }),
    );
  });

  it("returns { queued: true }", async () => {
    const result = await triggerSelfUpgrade();
    expect(result).toEqual({ queued: true });
  });
});

// ─── triggerSelfUpgrade – guard: already-running ──────────────────────────────

describe("triggerSelfUpgrade – guard: already-running", () => {
  it("returns queued: false with reason already-running when a run is active", async () => {
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue({
      ...mockRun,
      status: "running",
      runId: "SUR-RUNNING1",
    } as never);

    const result = await triggerSelfUpgrade();

    expect(result).toEqual(
      expect.objectContaining({ queued: false, reason: "already-running" }),
    );
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it("includes runId of the active run in the response", async () => {
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue({
      ...mockRun,
      status: "running",
      runId: "SUR-RUNNING1",
    } as never);

    const result = await triggerSelfUpgrade() as { runId?: string };

    expect(result.runId).toBe("SUR-RUNNING1");
  });

  it("applies already-running guard even when dryRun is true", async () => {
    vi.mocked(SelfUpgrade.getLatestRun).mockResolvedValue({
      ...mockRun,
      status: "running",
      runId: "SUR-RUNNING1",
    } as never);

    const result = await triggerSelfUpgrade({ dryRun: true });

    expect(result).toEqual(
      expect.objectContaining({ queued: false, reason: "already-running" }),
    );
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });
});

// ─── triggerSelfUpgrade – guard: invalid-config ───────────────────────────────

describe("triggerSelfUpgrade – guard: invalid-config", () => {
  it("returns queued: false with reason disabled when config.enabled is false", async () => {
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue({
      ...mockConfig,
      enabled: false,
    } as never);

    const result = await triggerSelfUpgrade();

    expect(result).toEqual(
      expect.objectContaining({ queued: false, reason: "disabled" }),
    );
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it("dryRun bypasses the disabled guard and dispatches the event", async () => {
    vi.mocked(SelfUpgrade.getSelfUpgradeConfig).mockResolvedValue({
      ...mockConfig,
      enabled: false,
    } as never);

    const result = await triggerSelfUpgrade({ dryRun: true });

    expect(result).toEqual({ queued: true });
    expect(vi.mocked(inngest.send)).toHaveBeenCalled();
  });
});
