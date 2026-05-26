import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  areOptionalStartupTasksEnabled,
  isInngestSelfSyncOnBootEnabled,
  isStartupModelRevalidationEnabled,
  warnIfLegacyHiveTokenEnvSet,
  syncPlatformVersionOnBoot,
} from "./instrumentation";

const syncPlatformVersionConfigMock = vi.fn();

vi.mock("@/lib/platform/version-config", () => ({
  syncPlatformVersionConfig: (...args: unknown[]) => syncPlatformVersionConfigMock(...args),
}));

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
