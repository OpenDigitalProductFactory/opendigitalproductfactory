import { describe, expect, it } from "vitest";

import { prepareUpgradeSource, type GitResult, type GitRunner } from "./prepare-source";

const SHA = "1111111111111111111111111111111111111111";
const UPSTREAM = "2222222222222222222222222222222222222222";
const MERGE = "3333333333333333333333333333333333333333";

const ok = (stdout = ""): GitResult => ({ stdout, stderr: "", code: 0 });
const fail = (stderr = "boom", code = 1): GitResult => ({ stdout: "", stderr, code });

/**
 * Build a fake GitRunner from a matcher list. Each git call is matched by a
 * substring of its joined argv; first match wins. Records the calls for asserts.
 */
function fakeGit(routes: Array<[string, GitResult]>): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner = (async (args: string[]) => {
    calls.push(args);
    const joined = args.join(" ");
    for (const [needle, result] of routes) {
      if (joined.includes(needle)) return result;
    }
    return ok();
  }) as GitRunner & { calls: string[][] };
  runner.calls = calls;
  return runner;
}

const baseUpstream = {
  sourceMode: "upstream" as const,
  hostSourcePath: "/host-dpf",
  remote: "origin",
  branch: "main",
  installBranch: "dpf/install",
};

describe("prepareUpgradeSource — local mode", () => {
  it("stamps a clean working tree with its bare HEAD", async () => {
    const git = fakeGit([
      ["rev-parse HEAD", ok(`${SHA}\n`)],
      ["status --porcelain", ok("")],
    ]);
    const r = await prepareUpgradeSource({ ...baseUpstream, sourceMode: "local" }, git);
    expect(r).toEqual({ ok: true, mode: "local", stamp: SHA });
    // local mode must NOT fetch or merge.
    expect(git.calls.some((c) => c.includes("fetch") || c.includes("merge"))).toBe(false);
  });

  it("appends -dirty when the tree has uncommitted changes", async () => {
    const git = fakeGit([
      ["rev-parse HEAD", ok(`${SHA}\n`)],
      ["status --porcelain", ok(" M apps/web/x.ts\n")],
    ]);
    const r = await prepareUpgradeSource({ ...baseUpstream, sourceMode: "local" }, git);
    expect(r).toMatchObject({ ok: true, stamp: `${SHA}-dirty` });
  });
});

describe("prepareUpgradeSource — upstream mode", () => {
  it("fetches, checks out an existing install branch, merges, and stamps the merge commit", async () => {
    const git = fakeGit([
      ["fetch origin main", ok()],
      ["rev-parse origin/main", ok(`${UPSTREAM}\n`)],
      ["rev-parse --verify --quiet dpf/install", ok(`${SHA}\n`)], // branch exists
      ["merge --no-edit --no-ff", ok()],
      ["rev-parse HEAD", ok(`${MERGE}\n`)],
      ["status --porcelain", ok("")],
    ]);
    const r = await prepareUpgradeSource(baseUpstream, git);
    expect(r).toEqual({ ok: true, mode: "upstream", stamp: MERGE, upstreamSha: UPSTREAM });
    // existing branch is checked out, not recreated/reset.
    expect(git.calls.some((c) => c.join(" ").includes("checkout dpf/install"))).toBe(true);
    expect(git.calls.some((c) => c.includes("-B"))).toBe(false);
  });

  it("creates the install branch from HEAD on first run", async () => {
    const git = fakeGit([
      ["fetch origin main", ok()],
      ["rev-parse origin/main", ok(`${UPSTREAM}\n`)],
      ["rev-parse --verify --quiet dpf/install", fail("", 1)], // branch absent
      ["checkout -b dpf/install", ok()],
      ["merge --no-edit --no-ff", ok()],
      ["rev-parse HEAD", ok(`${MERGE}\n`)],
      ["status --porcelain", ok("")],
    ]);
    const r = await prepareUpgradeSource(baseUpstream, git);
    expect(r).toMatchObject({ ok: true, stamp: MERGE });
    expect(git.calls.some((c) => c.join(" ").includes("checkout -b dpf/install"))).toBe(true);
  });

  it("defers on merge conflict: reports the files and aborts the merge", async () => {
    const git = fakeGit([
      ["fetch origin main", ok()],
      ["rev-parse origin/main", ok(`${UPSTREAM}\n`)],
      ["rev-parse --verify --quiet dpf/install", ok(`${SHA}\n`)],
      ["merge --no-edit --no-ff", fail("CONFLICT", 1)],
      ["diff --name-only --diff-filter=U", ok("apps/web/a.ts\napps/web/b.ts\n")],
      ["merge --abort", ok()],
    ]);
    const r = await prepareUpgradeSource(baseUpstream, git);
    expect(r).toMatchObject({
      ok: false,
      reason: "merge-conflict",
      conflictFiles: ["apps/web/a.ts", "apps/web/b.ts"],
      upstreamSha: UPSTREAM,
    });
    // the clone must be returned to a clean state.
    expect(git.calls.some((c) => c.join(" ").includes("merge --abort"))).toBe(true);
  });

  it("returns no-target when the upstream ref cannot be resolved", async () => {
    const git = fakeGit([
      ["fetch origin main", ok()],
      ["rev-parse origin/main", fail("unknown revision", 128)],
    ]);
    const r = await prepareUpgradeSource(baseUpstream, git);
    expect(r).toMatchObject({ ok: false, reason: "no-target" });
    // must not attempt a merge with no resolved target.
    expect(git.calls.some((c) => c.includes("merge"))).toBe(false);
  });

  it("surfaces a fetch failure as prep-error without merging", async () => {
    const git = fakeGit([["fetch origin main", fail("network down", 1)]]);
    const r = await prepareUpgradeSource(baseUpstream, git);
    expect(r).toMatchObject({ ok: false, reason: "prep-error" });
    expect(git.calls.some((c) => c.includes("merge"))).toBe(false);
  });
});
