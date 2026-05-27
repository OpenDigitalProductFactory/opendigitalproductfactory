import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findUnique: vi.fn() },
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("@/lib/platform/image-version", () => ({
  readImageVersion: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { execFileSync } from "node:child_process";
import { readImageVersion } from "@/lib/platform/image-version";
import { getDeployedSha, shaContains, getBuildMergeSha, isFeatureBuildDeployed } from "./completion";

function mockBuild(gitCommitHash: string | null): void {
  vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue(
    gitCommitHash !== null
      ? ({ productVersions: [{ gitCommitHash }] } as never)
      : ({ productVersions: [] } as never),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.DEPLOYED_SHA;
  vi.mocked(readImageVersion).mockResolvedValue(null);
});

// ─── getDeployedSha ──────────────────────────────────────────────────────────

describe("getDeployedSha", () => {
  it("returns null when DEPLOYED_SHA env var and image-version file are absent", async () => {
    vi.mocked(readImageVersion).mockResolvedValue(null);
    expect(await getDeployedSha()).toBeNull();
  });

  it("returns the DEPLOYED_SHA env var value when set", async () => {
    process.env.DEPLOYED_SHA = "abc123def456";
    expect(await getDeployedSha()).toBe("abc123def456");
  });

  it("falls back to /app/.dpf-image-version (git-sha source) when env var is unset", async () => {
    vi.mocked(readImageVersion).mockResolvedValue({
      raw: "abcdef0123456789abcdef0123456789abcdef01",
      source: "git-sha",
    });
    expect(await getDeployedSha()).toBe(
      "abcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("falls back to /app/.dpf-image-version (content-hash source) when env var is unset", async () => {
    vi.mocked(readImageVersion).mockResolvedValue({
      raw: "b5cdebc05e7fefb39f3d78b42348de1e81c64bae0e2bd57632387aef9c6ab5b2",
      source: "content-hash",
    });
    expect(await getDeployedSha()).toBe(
      "b5cdebc05e7fefb39f3d78b42348de1e81c64bae0e2bd57632387aef9c6ab5b2",
    );
  });

  it("prefers DEPLOYED_SHA env var over image-version file", async () => {
    process.env.DEPLOYED_SHA = "env-sha-wins";
    vi.mocked(readImageVersion).mockResolvedValue({
      raw: "image-sha-loses",
      source: "git-sha",
    });
    expect(await getDeployedSha()).toBe("env-sha-wins");
  });
});

// ─── shaContains ─────────────────────────────────────────────────────────────

describe("shaContains", () => {
  it("returns true for identical full SHAs", () => {
    expect(shaContains("abc123def456", "abc123def456")).toBe(true);
  });

  it("returns true when deployedSha starts with mergeSha (short-SHA prefix)", () => {
    expect(shaContains("abc123def456", "abc123")).toBe(true);
  });

  it("returns true when mergeSha starts with deployedSha (abbreviated deployed SHA)", () => {
    expect(shaContains("abc123", "abc123def456")).toBe(true);
  });

  it("returns false for empty deployedSha", () => {
    expect(shaContains("", "abc123")).toBe(false);
  });

  it("returns false for empty mergeSha", () => {
    expect(shaContains("abc123", "")).toBe(false);
  });

  it("returns false when SHAs are unrelated and git ancestry fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not an ancestor");
    });
    expect(shaContains("def456xyz", "abc123xyz")).toBe(false);
  });

  it("returns true when git confirms ancestry (no prefix match)", () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
    expect(shaContains("deployedsha1", "mergesha1")).toBe(true);
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      "git",
      ["merge-base", "--is-ancestor", "mergesha1", "deployedsha1"],
      { stdio: "pipe" },
    );
  });
});

// ─── getBuildMergeSha ────────────────────────────────────────────────────────

describe("getBuildMergeSha", () => {
  it("returns null when the build has no ProductVersion", async () => {
    mockBuild(null);
    expect(await getBuildMergeSha("FB-TEST-001")).toBeNull();
  });

  it("returns the gitCommitHash of the latest ProductVersion", async () => {
    mockBuild("abc123def456full");
    expect(await getBuildMergeSha("FB-TEST-001")).toBe("abc123def456full");
  });

  it("returns null when the build record does not exist", async () => {
    vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue(null);
    expect(await getBuildMergeSha("FB-MISSING")).toBeNull();
  });
});

// ─── isFeatureBuildDeployed ──────────────────────────────────────────────────

describe("isFeatureBuildDeployed", () => {
  it("returns false when neither DEPLOYED_SHA env nor image-version is set", async () => {
    vi.mocked(readImageVersion).mockResolvedValue(null);
    mockBuild("abc123def456");
    expect(await isFeatureBuildDeployed("FB-TEST-001")).toBe(false);
  });

  it("returns false when the build has no ProductVersion (no merge SHA)", async () => {
    process.env.DEPLOYED_SHA = "abc123def456";
    mockBuild(null);
    expect(await isFeatureBuildDeployed("FB-TEST-001")).toBe(false);
  });

  it("returns false when deployed SHA does not contain the merge SHA", async () => {
    process.env.DEPLOYED_SHA = "def456ghi789abc";
    mockBuild("zzz000mergesha1");
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not an ancestor");
    });
    expect(await isFeatureBuildDeployed("FB-TEST-001")).toBe(false);
  });

  it("returns true when deployed SHA exactly matches the merge SHA", async () => {
    process.env.DEPLOYED_SHA = "abc123def456";
    mockBuild("abc123def456");
    expect(await isFeatureBuildDeployed("FB-TEST-001")).toBe(true);
  });

  it("returns true when deployed SHA is a descendant of the merge SHA (git ancestry)", async () => {
    process.env.DEPLOYED_SHA = "newdeployedsha1";
    mockBuild("mergedcommitsha1");
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
    expect(await isFeatureBuildDeployed("FB-TEST-001")).toBe(true);
  });

  it("returns true when deployed SHA is prefixed by the merge SHA", async () => {
    process.env.DEPLOYED_SHA = "abc123def456full";
    mockBuild("abc123");
    expect(await isFeatureBuildDeployed("FB-TEST-001")).toBe(true);
  });
});
