import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRemoteHeadCommand,
  buildFetchCommand,
  buildHeadShaCommand,
  buildDirtyCheckCommand,
  buildMergeCommand,
  deriveDeployedStamp,
  compareUpgradeVersions,
  getUpgradeVersionState,
  isShaFresh,
  parseRemoteHeadSha,
  resetTargetShaCacheForTests,
  resolveTargetSha,
  TARGET_SHA_CACHE_TTL_MS,
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

describe("source-preparation command builders", () => {
  const at = { hostSourcePath: "/host-source", remote: "origin", branch: "main" };

  it("buildFetchCommand freshens the configured remote branch", () => {
    expect(buildFetchCommand(at)).toEqual(["git", "-C", "/host-source", "fetch", "origin", "main"]);
  });

  it("buildHeadShaCommand resolves the tree's own HEAD (the true built identity)", () => {
    expect(buildHeadShaCommand("/host-source")).toEqual(["git", "-C", "/host-source", "rev-parse", "HEAD"]);
  });

  it("buildDirtyCheckCommand asks for porcelain status", () => {
    expect(buildDirtyCheckCommand("/host-source")).toEqual(["git", "-C", "/host-source", "status", "--porcelain"]);
  });

  it("buildMergeCommand forces a real merge commit (--no-ff) of the upstream target", () => {
    expect(buildMergeCommand(at)).toEqual([
      "git",
      "-C",
      "/host-source",
      "merge",
      "--no-edit",
      "--no-ff",
      "origin/main",
    ]);
  });
});

describe("deriveDeployedStamp", () => {
  const sha = "cccccccccccccccccccccccccccccccccccccccc";

  it("returns the bare HEAD sha for a clean tree (comparable to a release)", () => {
    const stamp = deriveDeployedStamp(`${sha}\n`, false);
    expect(stamp).toBe(sha);
    expect(compareUpgradeVersions(stamp, sha)).toMatchObject({ comparable: true, upToDate: true });
  });

  it("appends -dirty for an uncommitted tree so it reads as not-a-tracked-release", () => {
    const stamp = deriveDeployedStamp(sha, true);
    expect(stamp).toBe(`${sha}-dirty`);
    // A -dirty token is not a 40-hex SHA, so the comparator refuses to grade it.
    expect(compareUpgradeVersions(stamp, sha)).toMatchObject({ comparable: false });
    expect(isShaFresh(stamp, sha)).toBe(false);
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

describe("parseRemoteHeadSha", () => {
  const sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("picks the SHA on the refs/heads/<branch> line and ignores other refs", () => {
    const stdout = `${"c".repeat(40)}\trefs/heads/main-old\n${sha.toUpperCase()}\trefs/heads/main\n`;
    expect(parseRemoteHeadSha(stdout, "main")).toBe(sha);
  });

  it("returns null when the branch is not listed or the SHA is malformed", () => {
    expect(parseRemoteHeadSha("", "main")).toBeNull();
    expect(parseRemoteHeadSha("not-a-sha\trefs/heads/main\n", "main")).toBeNull();
    expect(parseRemoteHeadSha(`${sha}\trefs/heads/release\n`, "main")).toBeNull();
  });
});

describe("resolveTargetSha (BI-4746F2A9: the target is the REMOTE head)", () => {
  const remoteSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const localSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const at = { hostSourceMountPath: "/host-source", repositoryRemote: "upstream", repositoryBranch: "release" };
  const lsArgs = ["-C", "/host-source", "ls-remote", "--heads", "upstream", "release"];
  const revParseArgs = ["-C", "/host-source", "rev-parse", "upstream/release"];
  const fetchArgs = ["-C", "/host-source", "fetch", "upstream", "release"];

  /** A fake git: answers by sub-command so the test states what each ref says. */
  function fakeGit(answers: { lsRemote?: string | Error; local?: string | Error; fetch?: Error }) {
    return vi.fn(async (_cmd: string, args: string[]) => {
      const sub = args[2];
      if (sub === "ls-remote") {
        if (answers.lsRemote instanceof Error) throw answers.lsRemote;
        return { stdout: answers.lsRemote ?? "" };
      }
      if (sub === "rev-parse") {
        if (answers.local instanceof Error) throw answers.local;
        return { stdout: answers.local ?? "" };
      }
      if (sub === "fetch") {
        if (answers.fetch) throw answers.fetch;
        return { stdout: "" };
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    });
  }

  let consoleSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetTargetShaCacheForTests();
    consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("asks the remote, not the local ref, and freshens the local ref when it is behind", async () => {
    const execFile = fakeGit({ lsRemote: `${remoteSha}\trefs/heads/release\n`, local: `${localSha}\n` });

    await expect(resolveTargetSha("stable", at, { execFile })).resolves.toBe(remoteSha);

    expect(execFile).toHaveBeenCalledWith("git", lsArgs);
    expect(execFile).toHaveBeenCalledWith("git", revParseArgs);
    expect(execFile).toHaveBeenCalledWith("git", fetchArgs);
  });

  it("does not fetch when the local ref already matches the remote", async () => {
    const execFile = fakeGit({ lsRemote: `${remoteSha}\trefs/heads/release\n`, local: `${remoteSha}\n` });

    await expect(resolveTargetSha("stable", at, { execFile })).resolves.toBe(remoteSha);

    expect(execFile).not.toHaveBeenCalledWith("git", fetchArgs);
  });

  it("still answers with the remote SHA when the freshening fetch fails", async () => {
    const execFile = fakeGit({
      lsRemote: `${remoteSha}\trefs/heads/release\n`,
      local: `${localSha}\n`,
      fetch: new Error("index.lock held"),
    });

    await expect(resolveTargetSha("stable", at, { execFile })).resolves.toBe(remoteSha);
    expect(consoleSpy).toHaveBeenCalledWith(
      "self-upgrade.target-fetch-skipped",
      expect.objectContaining({ channel: "stable", message: expect.stringContaining("index.lock") }),
    );
  });

  it("falls back to the local ref when the remote is unreachable, and says so", async () => {
    const execFile = fakeGit({ lsRemote: new Error("Could not resolve host"), local: `${localSha}\n` });

    await expect(resolveTargetSha("stable", at, { execFile })).resolves.toBe(localSha);

    expect(execFile).not.toHaveBeenCalledWith("git", fetchArgs);
    expect(consoleSpy).toHaveBeenCalledWith(
      "self-upgrade.target-from-local-ref",
      expect.objectContaining({
        channel: "stable",
        reason: "remote-unreachable",
        message: expect.stringContaining("Could not resolve host"),
      }),
    );
  });

  it("returns null and logs when neither the remote nor the local ref yields a git SHA", async () => {
    const execFile = fakeGit({ lsRemote: "", local: "not-a-sha\n" });

    await expect(resolveTargetSha("stable", at, { execFile })).resolves.toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "self-upgrade.no-target",
      expect.objectContaining({ channel: "stable", reason: "target-not-git-sha" }),
    );
  });

  it("returns null and logs when every git call fails", async () => {
    const execFile = fakeGit({ lsRemote: new Error("offline"), local: new Error("not a git repository") });

    await expect(resolveTargetSha("stable", at, { execFile })).resolves.toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "self-upgrade.no-target",
      expect.objectContaining({ channel: "stable", reason: "target-resolution-failed" }),
    );
  });

  it("caches the remote answer for about a minute, then asks again", async () => {
    const execFile = fakeGit({ lsRemote: `${remoteSha}\trefs/heads/release\n`, local: `${remoteSha}\n` });
    let clock = 1_000_000;
    const now = () => clock;

    await resolveTargetSha("stable", at, { execFile }, { now });
    await resolveTargetSha("stable", at, { execFile }, { now });
    expect(execFile.mock.calls.filter(([, args]) => args[2] === "ls-remote")).toHaveLength(1);

    clock += TARGET_SHA_CACHE_TTL_MS + 1;
    await resolveTargetSha("stable", at, { execFile }, { now });
    expect(execFile.mock.calls.filter(([, args]) => args[2] === "ls-remote")).toHaveLength(2);
  });

  it("does not cache a miss, so the next render asks the remote again", async () => {
    const execFile = fakeGit({ lsRemote: new Error("offline"), local: "" });

    await expect(resolveTargetSha("stable", at, { execFile })).resolves.toBeNull();
    await expect(resolveTargetSha("stable", at, { execFile })).resolves.toBeNull();
    expect(execFile.mock.calls.filter(([, args]) => args[2] === "ls-remote")).toHaveLength(2);
  });

  it("shares one in-flight remote call between concurrent renders", async () => {
    const execFile = fakeGit({ lsRemote: `${remoteSha}\trefs/heads/release\n`, local: `${remoteSha}\n` });

    const results = await Promise.all([
      resolveTargetSha("stable", at, { execFile }),
      resolveTargetSha("stable", at, { execFile }),
      resolveTargetSha("stable", at, { execFile }),
    ]);

    expect(results).toEqual([remoteSha, remoteSha, remoteSha]);
    expect(execFile.mock.calls.filter(([, args]) => args[2] === "ls-remote")).toHaveLength(1);
  });
});
