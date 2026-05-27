import { describe, expect, it, vi } from "vitest";

import {
  buildRemoteHeadCommand,
  compareUpgradeVersions,
  getUpgradeVersionState,
  isShaFresh,
  resolveTargetSha,
} from "./version";

describe("compareUpgradeVersions", () => {
  it("marks the portal stale when the running image SHA differs from origin/main", () => {
    expect(compareUpgradeVersions("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toEqual({
      currentSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      targetSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      comparable: true,
      upToDate: false,
      reason: "behind-target",
    });
  });

  it("marks content-hash image versions incomparable", () => {
    expect(compareUpgradeVersions("not-a-git-sha", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toMatchObject({
      comparable: false,
      upToDate: false,
      reason: "current-not-git-sha",
    });
  });
});

describe("buildRemoteHeadCommand", () => {
  it("fetches and resolves the configured remote branch inside the host checkout", () => {
    expect(buildRemoteHeadCommand({ hostSourcePath: "/host-source", remote: "origin", branch: "main" })).toEqual([
      "git",
      "-C",
      "/host-source",
      "rev-parse",
      "origin/main",
    ]);
  });
});

describe("getUpgradeVersionState", () => {
  it("reads current image version and target remote SHA through injected dependencies", async () => {
    const state = await getUpgradeVersionState(
      {
        hostSourceMountPath: "/host-source",
        repositoryRemote: "origin",
        repositoryBranch: "main",
      },
      {
        readCurrentVersion: vi.fn().mockResolvedValue({ version: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", comparableToGitSha: true }),
        execFile: vi.fn().mockResolvedValue({ stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n" }),
      },
    );

    expect(state.upToDate).toBe(false);
    expect(state.targetSha).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });
});

describe("isShaFresh", () => {
  const SHA_A = "a285216a779f794faa6bdaca95d1d60239bbc264";
  const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("returns true when both sides are the same 40-char git SHA", () => {
    expect(isShaFresh(SHA_A, SHA_A)).toBe(true);
  });

  it("returns true with case-insensitive comparison", () => {
    expect(isShaFresh(SHA_A.toUpperCase(), SHA_A)).toBe(true);
  });

  it("returns false for two different git SHAs", () => {
    expect(isShaFresh(SHA_A, SHA_B)).toBe(false);
  });

  it("returns false when deployedSha is null", () => {
    expect(isShaFresh(null, SHA_A)).toBe(false);
  });

  it("returns false when deployedSha is a 64-char content hash even if prefix matches", () => {
    // A 64-char content hash that happens to start with the same chars as a
    // 40-char git SHA should NOT be reported as fresh — the previous prefix-
    // based implementation would have incorrectly returned true here.
    const contentHash = SHA_A + "0".repeat(24);
    expect(isShaFresh(contentHash, SHA_A)).toBe(false);
  });

  it("returns false when target is not a git SHA", () => {
    expect(isShaFresh(SHA_A, "not-a-sha")).toBe(false);
  });
});

describe("resolveTargetSha", () => {
  it("resolves the configured repository branch head as the target SHA", async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
    });

    const result = await resolveTargetSha(
      "stable",
      {
        hostSourceMountPath: "/host-source",
        repositoryRemote: "upstream",
        repositoryBranch: "release",
      },
      { execFile },
    );

    expect(result).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["-C", "/host-source", "rev-parse", "upstream/release"],
    );
  });

  it("returns null and logs when the resolved target is not a git SHA", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await resolveTargetSha(
      "stable",
      { hostSourceMountPath: "/host-source" },
      { execFile: vi.fn().mockResolvedValue({ stdout: "not-a-sha\n" }) },
    );

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("self-upgrade.no-target"),
      expect.objectContaining({ channel: "stable", reason: "target-not-git-sha" }),
    );
    consoleSpy.mockRestore();
  });
});
