import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadPlatformVersion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads version.json and returns a validated version/publishedAt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dpf-version-test-"));
    const path = join(dir, "version.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: "1.0.0",
        publishedAt: "2026-05-24T00:00:00.000Z",
        note: "test",
      }),
    );
    vi.stubEnv("DPF_VERSION_FILE", path);

    const { loadPlatformVersion } = await import("./version");
    const v = await loadPlatformVersion();
    expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(v.publishedAt).toBeInstanceOf(Date);

    rmSync(dir, { recursive: true, force: true });
  });

  it("includes gitSha from DEPLOYED_SHA when present", async () => {
    vi.stubEnv("DEPLOYED_SHA", "abc1234567890abcdef1234567890abcdef12345");
    const { loadPlatformVersion } = await import("./version");
    const v = await loadPlatformVersion();
    expect(v.gitSha).toBe("abc1234567890abcdef1234567890abcdef12345");
  });

  it("returns null gitSha when DEPLOYED_SHA is unset and image-version is absent", async () => {
    vi.stubEnv("DEPLOYED_SHA", "");
    const { loadPlatformVersion } = await import("./version");
    const v = await loadPlatformVersion();
    expect(v.gitSha).toBeNull();
  });

  it("exposes imageVersion when /app/.dpf-image-version is readable", async () => {
    vi.stubEnv("DEPLOYED_SHA", "");
    vi.doMock("./image-version", () => ({
      readImageVersion: vi
        .fn()
        .mockResolvedValue({
          raw: "b5cdebc05e7fefb39f3d78b42348de1e81c64bae0e2bd57632387aef9c6ab5b2",
          source: "content-hash",
        }),
      readImageBuiltAt: vi.fn().mockResolvedValue(null),
    }));
    const { loadPlatformVersion } = await import("./version");
    const v = await loadPlatformVersion();
    expect(v.imageVersion).toEqual({
      raw: "b5cdebc05e7fefb39f3d78b42348de1e81c64bae0e2bd57632387aef9c6ab5b2",
      source: "content-hash",
    });
    // gitSha stays null because content-hash images aren't comparable.
    expect(v.gitSha).toBeNull();
    vi.doUnmock("./image-version");
  });

  it("throws a useful error for invalid semver", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dpf-version-test-"));
    const path = join(dir, "version.json");
    writeFileSync(
      path,
      JSON.stringify({ version: "latest", publishedAt: "2026-05-24T00:00:00.000Z" }),
    );
    vi.stubEnv("DPF_VERSION_FILE", path);

    const { loadPlatformVersion } = await import("./version");
    await expect(loadPlatformVersion()).rejects.toThrow(/Invalid platform version/);

    rmSync(dir, { recursive: true, force: true });
  });

  it("memoizes the result across calls", async () => {
    const { loadPlatformVersion } = await import("./version");
    const a = await loadPlatformVersion();
    const b = await loadPlatformVersion();
    expect(a).toBe(b); // same object reference
  });
});
