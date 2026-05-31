import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  areOptionalStartupTasksEnabled,
  isInngestSelfSyncOnBootEnabled,
  isStartupModelRevalidationEnabled,
  reconcileSelfUpgradeRunsOnBoot,
  warnIfLegacyHiveTokenEnvSet,
  syncPlatformVersionOnBoot,
} from "./instrumentation";

const syncPlatformVersionConfigMock = vi.fn();
const getDeployedShaMock = vi.fn();
const completeRunMock = vi.fn();
const failRunMock = vi.fn();
const selfUpgradeRunFindManyMock = vi.fn();

vi.mock("@/lib/platform/version-config", () => ({
  syncPlatformVersionConfig: (...args: unknown[]) => syncPlatformVersionConfigMock(...args),
}));

vi.mock("@/lib/self-upgrade/completion", () => ({
  getDeployedSha: () => getDeployedShaMock(),
}));

vi.mock("@/lib/self-upgrade/run-store", () => ({
  completeRun: (...args: unknown[]) => completeRunMock(...args),
  failRun: (...args: unknown[]) => failRunMock(...args),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    selfUpgradeRun: {
      findMany: (...args: unknown[]) => selfUpgradeRunFindManyMock(...args),
    },
  },
}));

beforeEach(() => {
  getDeployedShaMock.mockReset();
  completeRunMock.mockReset();
  failRunMock.mockReset();
  selfUpgradeRunFindManyMock.mockReset();
});

describe("warnIfLegacyHiveTokenEnvSet", () => {
  let originalEnvToken: string | undefined;

  beforeEach(() => {
    originalEnvToken = process.env.HIVE_CONTRIBUTION_TOKEN;
  });

  afterEach(() => {
    if (originalEnvToken === undefined) delete process.env.HIVE_CONTRIBUTION_TOKEN;
    else process.env.HIVE_CONTRIBUTION_TOKEN = originalEnvToken;
  });

  it("does nothing when the env var is unset", () => {
    delete process.env.HIVE_CONTRIBUTION_TOKEN;
    const warn = vi.fn();
    const fired = warnIfLegacyHiveTokenEnvSet({ warn });
    expect(fired).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("emits a deprecation warning when the env var is set", () => {
    process.env.HIVE_CONTRIBUTION_TOKEN = "ghp_legacy";
    const warn = vi.fn();
    const fired = warnIfLegacyHiveTokenEnvSet({ warn });
    expect(fired).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain("[deprecation]");
    expect(message).toContain("HIVE_CONTRIBUTION_TOKEN");
    expect(message).toContain("Admin > Platform Development");
    expect(message).toContain("60 days");
  });
});

describe("syncPlatformVersionOnBoot", () => {
  beforeEach(() => {
    syncPlatformVersionConfigMock.mockReset();
  });

  it("returns true and logs success when sync completes", async () => {
    syncPlatformVersionConfigMock.mockResolvedValueOnce(undefined);
    const log = vi.fn();
    const error = vi.fn();

    const result = await syncPlatformVersionOnBoot({ log, error });

    expect(result).toBe(true);
    expect(syncPlatformVersionConfigMock).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("[platform-version]");
    expect(log.mock.calls[0]![0]).toContain("Synced");
    expect(error).not.toHaveBeenCalled();
  });

  it("returns false and logs error when sync throws", async () => {
    const boom = new Error("db is offline");
    syncPlatformVersionConfigMock.mockRejectedValueOnce(boom);
    const log = vi.fn();
    const error = vi.fn();

    const result = await syncPlatformVersionOnBoot({ log, error });

    expect(result).toBe(false);
    expect(syncPlatformVersionConfigMock).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain("[platform-version]");
    expect(error.mock.calls[0]![0]).toContain("Failed");
    expect(error.mock.calls[0]![1]).toBe(boom);
  });
});

describe("reconcileSelfUpgradeRunsOnBoot", () => {
  it("marks an upstream-mode run succeeded when deployed SHA matches expected deployed merge SHA", async () => {
    getDeployedShaMock.mockResolvedValueOnce("merge-sha");
    selfUpgradeRunFindManyMock.mockResolvedValueOnce([
      { runId: "SUR-MERGE", deployedSha: "merge-sha", targetSha: "upstream-sha" },
    ]);
    completeRunMock.mockResolvedValueOnce({});
    const log = vi.fn();
    const error = vi.fn();

    const result = await reconcileSelfUpgradeRunsOnBoot({ log, error });

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(completeRunMock).toHaveBeenCalledWith("SUR-MERGE");
    expect(failRunMock).not.toHaveBeenCalled();
  });

  it("falls back to targetSha for legacy/local rows without deployedSha", async () => {
    getDeployedShaMock.mockResolvedValueOnce("same-sha");
    selfUpgradeRunFindManyMock.mockResolvedValueOnce([
      { runId: "SUR-LOCAL", deployedSha: null, targetSha: "same-sha" },
    ]);
    completeRunMock.mockResolvedValueOnce({});

    const result = await reconcileSelfUpgradeRunsOnBoot({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(completeRunMock).toHaveBeenCalledWith("SUR-LOCAL");
  });

  it("fails an orphaned run with deployed, expected, and target evidence", async () => {
    getDeployedShaMock.mockResolvedValueOnce("actual-sha");
    selfUpgradeRunFindManyMock.mockResolvedValueOnce([
      { runId: "SUR-ORPHAN", deployedSha: "expected-sha", targetSha: "upstream-sha" },
    ]);
    failRunMock.mockResolvedValueOnce({});

    const result = await reconcileSelfUpgradeRunsOnBoot({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ succeeded: 0, failed: 1 });
    expect(failRunMock).toHaveBeenCalledWith(
      "SUR-ORPHAN",
      expect.stringContaining("deployed=actual-sha expected=expected-sha target=upstream-sha"),
    );
  });
});

describe("isStartupModelRevalidationEnabled", () => {
  it("requires explicit opt-in before startup revalidation runs", () => {
    expect(isStartupModelRevalidationEnabled({})).toBe(false);
    expect(
      isStartupModelRevalidationEnabled({
        DPF_STARTUP_MODEL_REVALIDATION_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      isStartupModelRevalidationEnabled({
        DPF_STARTUP_MODEL_REVALIDATION_ENABLED: "true",
      }),
    ).toBe(true);
  });
});

describe("isInngestSelfSyncOnBootEnabled", () => {
  it("requires explicit opt-in before the portal self-registers with Inngest on boot", () => {
    expect(isInngestSelfSyncOnBootEnabled({})).toBe(false);
    expect(
      isInngestSelfSyncOnBootEnabled({
        DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      isInngestSelfSyncOnBootEnabled({
        DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED: "true",
      }),
    ).toBe(true);
  });
});

describe("areOptionalStartupTasksEnabled", () => {
  it("requires explicit opt-in before nonessential startup maintenance runs", () => {
    expect(areOptionalStartupTasksEnabled({})).toBe(false);
    expect(
      areOptionalStartupTasksEnabled({
        DPF_OPTIONAL_STARTUP_TASKS_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      areOptionalStartupTasksEnabled({
        DPF_OPTIONAL_STARTUP_TASKS_ENABLED: "true",
      }),
    ).toBe(true);
  });
});
