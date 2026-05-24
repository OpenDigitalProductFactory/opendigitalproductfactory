import { describe, expect, it, vi } from "vitest";

import {
  buildRemoteHeadCommand,
  compareUpgradeVersions,
  getUpgradeVersionState,
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

describe("resolveTargetSha", () => {
  it("returns null and logs a structured INFO message about pending channel resolution", async () => {
    const { resolveTargetSha } = await import("./version");
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await resolveTargetSha("stable");

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("self-upgrade.no-target"),
      expect.objectContaining({ channel: "stable", reason: "channel-resolution-not-implemented" }),
    );

    consoleSpy.mockRestore();
  });
});
