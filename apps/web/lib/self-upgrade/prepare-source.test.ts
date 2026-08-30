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

describe("prepareUpgradeSource — upstream mode (isolated workspace, BI-4043A64B)", () => {
  // The workspace lives under the host clone but the merge runs entirely inside
  // it; the host clone's WORKING TREE is never checked-out/merged/cleaned.
  const baseWorkspace = { ...baseUpstream, workspacePath: "/host-dpf/.upgrade-workspace" };

  // Asserts no git op mutates the host clone's working tree directly
  // (`-C /host-dpf <checkout|merge|reset|clean>`). The retired legacy path did.
  function noHostTreeMutation(calls: string[][]): boolean {
    const mutating = new Set(["checkout", "merge", "reset", "clean"]);
    return !calls.some(
      (c) => c[0] === "-C" && c[1] === "/host-dpf" && c.some((a) => mutating.has(a)),
    );
  }

  it("refuses an upstream merge without an isolated workspace (legacy direct-merge retired)", async () => {
    const git = fakeGit([]);
    const r = await prepareUpgradeSource(baseUpstream, git); // no workspacePath
    expect(r).toMatchObject({ ok: false, reason: "prep-error" });
    if (r.ok) return;
    expect(r.message).toMatch(/isolated workspace/i);
    // Must NOT touch the host clone at all — no checkout/merge against it.
    expect(git.calls.some((c) => c.includes("checkout") || c.includes("merge"))).toBe(false);
  });

  it("merges upstream inside the workspace and stamps the merge commit (clean)", async () => {
    const git = fakeGit([
      ["rev-parse --git-dir", ok()], // workspace already initialized
      ["config --get remote.origin.url", ok("https://github.com/x/y.git\n")],
      ["config --get remote.upgrade-upstream.url", ok("")],
      ["rev-parse upgrade-upstream/main", ok(`${UPSTREAM}\n`)],
      ["diff --quiet", fail("local content delta", 1)],
      ["rev-parse HEAD", ok(`${MERGE}\n`)],
      ["status --porcelain", ok("")],
    ]);
    const r = await prepareUpgradeSource(baseWorkspace, git);
    expect(r).toEqual({ ok: true, mode: "upstream", stamp: MERGE, upstreamSha: UPSTREAM });
    expect(noHostTreeMutation(git.calls)).toBe(true);
    // The merge runs in the workspace tree.
    expect(
      git.calls.some(
        (c) => c[0] === "-C" && c[1] === "/host-dpf/.upgrade-workspace" && c.includes("merge"),
      ),
    ).toBe(true);
    // The new install-branch tip is pushed back to the install clone (ref-only).
    expect(
      git.calls.some((c) => c.join(" ").includes("push origin HEAD:refs/heads/dpf/install")),
    ).toBe(true);
  });

  // ── Git LFS materialization (BI-FEE26C36 follow-on) ──────────────────────
  // The workspace is the promoter's Docker build context and Dockerfile asserts
  // real bytes for the LFS-tracked IT4IT workbook (#4843). A pointer stub here
  // fails the image build two minutes in, so prep must catch it and say why.
  const cleanMergeRoutes: Array<[string, GitResult]> = [
    ["rev-parse --git-dir", ok()],
    ["config --get remote.origin.url", ok("https://github.com/x/y.git\n")],
    ["config --get remote.upgrade-upstream.url", ok("")],
    ["rev-parse upgrade-upstream/main", ok(`${UPSTREAM}\n`)],
    ["diff --quiet", fail("local content delta", 1)],
    ["rev-parse HEAD", ok(`${MERGE}\n`)],
    ["status --porcelain", ok("")],
  ];

  it("materializes LFS objects in the workspace before stamping", async () => {
    const git = fakeGit(cleanMergeRoutes);
    await prepareUpgradeSource(baseWorkspace, git);
    expect(
      git.calls.some((c) => c.join(" ") === "-C /host-dpf/.upgrade-workspace lfs pull"),
    ).toBe(true);
  });

  it("fails with a named reason when an LFS-tracked path is still a pointer stub", async () => {
    const git = fakeGit([
      ...cleanMergeRoutes,
      [
        "lfs ls-files",
        ok("be8951db1c - docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx\n"),
      ],
    ]);
    const r = await prepareUpgradeSource(baseWorkspace, git);
    expect(r).toMatchObject({ ok: false, reason: "lfs-unmaterialized" });
    if (r.ok) return;
    expect(r.message).toContain("IT4IT_Functional_Criteria_Taxonomy.xlsx");
    // Never push a tree the promoter cannot build.
    expect(git.calls.some((c) => c.includes("push"))).toBe(false);
  });

  it("stops when materialization cannot be verified at all (no git-lfs binary)", async () => {
    const git = fakeGit([
      ...cleanMergeRoutes,
      ["lfs ls-files", fail("git: 'lfs' is not a git command", 1)],
    ]);
    const r = await prepareUpgradeSource(baseWorkspace, git);
    expect(r).toMatchObject({ ok: false, reason: "lfs-unmaterialized" });
    if (r.ok) return;
    expect(r.message).toMatch(/git-lfs/);
  });

  it("proceeds when every tracked object is materialized", async () => {
    const git = fakeGit([
      ...cleanMergeRoutes,
      [
        "lfs ls-files",
        ok("be8951db1c * docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx\n"),
      ],
    ]);
    const r = await prepareUpgradeSource(baseWorkspace, git);
    expect(r).toEqual({ ok: true, mode: "upstream", stamp: MERGE, upstreamSha: UPSTREAM });
  });

  it("advances an upstream-only install to the exact canonical upstream commit", async () => {
    const git = fakeGit([
      ["rev-parse --git-dir", ok()],
      ["config --get remote.origin.url", ok("https://github.com/x/y.git\n")],
      ["config --get remote.upgrade-upstream.url", ok("")],
      ["rev-parse upgrade-upstream/main", ok(`${UPSTREAM}\n`)],
      ["merge-base", ok(`${SHA}\n`)],
      ["diff --quiet", ok()],
      ["rev-parse HEAD", ok(`${UPSTREAM}\n`)],
      ["status --porcelain", ok("")],
    ]);

    const r = await prepareUpgradeSource(baseWorkspace, git);

    expect(r).toEqual({ ok: true, mode: "upstream", stamp: UPSTREAM, upstreamSha: UPSTREAM });
    expect(
      git.calls.some((c) =>
        c.join(" ").includes("reset --hard upgrade-upstream/main"),
      ),
    ).toBe(true);
    expect(git.calls.some((c) => c.includes("merge"))).toBe(false);
    expect(noHostTreeMutation(git.calls)).toBe(true);
  });

  it("defers on merge conflict and cleans the workspace (host tree untouched)", async () => {
    const git = fakeGit([
      ["rev-parse --git-dir", ok()],
      ["config --get remote.origin.url", ok("https://github.com/x/y.git\n")],
      ["config --get remote.upgrade-upstream.url", ok("")],
      ["rev-parse upgrade-upstream/main", ok(`${UPSTREAM}\n`)],
      ["merge --no-ff", fail("CONFLICT", 1)],
      ["diff --name-only --diff-filter=U", ok("apps/web/a.ts\napps/web/b.ts\n")],
    ]);
    const r = await prepareUpgradeSource(baseWorkspace, git);
    expect(r).toMatchObject({
      ok: false,
      reason: "merge-conflict",
      conflictFiles: ["apps/web/a.ts", "apps/web/b.ts"],
      upstreamSha: UPSTREAM,
    });
    expect(git.calls.some((c) => c.join(" ").includes("merge --abort"))).toBe(true);
    expect(noHostTreeMutation(git.calls)).toBe(true);
  });

  it("returns no-target when the upstream ref cannot be resolved in the workspace", async () => {
    const git = fakeGit([
      ["rev-parse --git-dir", ok()],
      ["config --get remote.origin.url", ok("https://github.com/x/y.git\n")],
      ["config --get remote.upgrade-upstream.url", ok("")],
      ["rev-parse upgrade-upstream/main", fail("unknown revision", 128)],
    ]);
    const r = await prepareUpgradeSource(baseWorkspace, git);
    expect(r).toMatchObject({ ok: false, reason: "no-target" });
    expect(git.calls.some((c) => c.join(" ").includes("merge --no-ff"))).toBe(false);
  });
});
