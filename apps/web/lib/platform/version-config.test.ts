import { describe, expect, it, vi } from "vitest";
import { syncPlatformVersionConfig, PLATFORM_VERSION_CONFIG_KEY } from "./version-config";

describe("syncPlatformVersionConfig", () => {
  it("upserts PlatformConfig platform.version from loaded version metadata", async () => {
    const upsert = vi.fn().mockResolvedValue({});

    await syncPlatformVersionConfig({
      load: async () => ({
        version: "1.0.0",
        publishedAt: new Date("2026-05-24T00:00:00.000Z"),
        gitSha: "abc123",
        imageVersion: { raw: "abc123", source: "git-sha" },
        buildDate: null,
        note: "baseline",
      }),
      platformConfig: { upsert },
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { key: PLATFORM_VERSION_CONFIG_KEY },
      update: {
        value: {
          version: "1.0.0",
          publishedAt: "2026-05-24T00:00:00.000Z",
          gitSha: "abc123",
          note: "baseline",
          source: "version.json",
        },
      },
      create: {
        key: PLATFORM_VERSION_CONFIG_KEY,
        value: {
          version: "1.0.0",
          publishedAt: "2026-05-24T00:00:00.000Z",
          gitSha: "abc123",
          note: "baseline",
          source: "version.json",
        },
      },
    });
  });
});
