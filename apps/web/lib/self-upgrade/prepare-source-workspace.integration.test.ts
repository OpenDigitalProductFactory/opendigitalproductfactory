import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareUpgradeSource, defaultGitRunner } from "./prepare-source";

// BI-A8A7CCFD — functional proof of the isolated-workspace path. Exercises
// the REAL git runner against REAL repos. No mocks. The whole point of this
// fix: the operator's install clone can be dirty / on a feature branch / etc.
// and the upgrade must succeed anyway because the merge happens elsewhere.

const GIT_AVAILABLE = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
const REAL_GIT_TEST_TIMEOUT_MS = 30_000;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
  }).toString();
}

function gitExec(args: string[]): void {
  execFileSync("git", args, { env: GIT_ENV });
}

function configureRepo(cwd: string): void {
  git(cwd, "config", "core.autocrlf", "false");
  git(cwd, "config", "core.eol", "lf");
  git(cwd, "config", "commit.gpgsign", "false");
}

function commit(cwd: string, file: string, content: string, msg: string): void {
  const dir = file.includes("/") ? join(cwd, file.split("/").slice(0, -1).join("/")) : cwd;
  if (dir !== cwd) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", "-A");
  git(cwd, "-c", "commit.gpgsign=false", "commit", "-m", msg);
}

/** upstream remote repo (bare-style on disk) + an install clone of it with a
 *  dpf/install branch carrying local commits. The workspace path is returned
 *  un-created so the test exercises the first-run init code path. */
function makeWorld(): {
  upstream: string;
  install: string;
  workspace: string;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), "dpf-upg-wsp-"));
  const upstream = join(root, "upstream");
  const install = join(root, "install");
  const workspace = join(root, "install", ".upgrade-workspace");
  gitExec(["init", "-b", "main", upstream]);
  configureRepo(upstream);
  // Receive-pack would refuse to push to a checked-out main; for the test the
  // upstream is just a source we fetch FROM, not push to. Setting
  // receive.denyCurrentBranch=ignore keeps the upstream simple.
  git(upstream, "config", "receive.denyCurrentBranch", "ignore");
  commit(upstream, "base.txt", "v1\n", "base");
  gitExec(["-c", "core.autocrlf=false", "-c", "core.eol=lf", "clone", "-q", upstream, install]);
  configureRepo(install);
  git(install, "config", "user.email", "t@t");
  git(install, "config", "user.name", "t");
  // Install clones in dev typically have dpf/install checked out OR a feature
  // branch — receive-pack will refuse pushes to a checked-out branch unless
  // configured otherwise. The fix expects the workspace push to succeed when
  // the install clone is NOT on dpf/install; tests below cover both cases.
  git(install, "config", "receive.denyCurrentBranch", "updateInstead");
  return { upstream, install, workspace, root };
}

describe.skipIf(!GIT_AVAILABLE)("prepareUpgradeSource — workspace-isolated (BI-A8A7CCFD)", () => {
  const cleanup: string[] = [];
  beforeAll(() => {
    return () => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true }));
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("does the upstream merge in the workspace, NOT in the install clone, even when install is dirty on a feature branch", async () => {
    const { upstream, install, workspace, root } = makeWorld();
    cleanup.push(root);

    // Set up the install clone in the exact shape that broke real upgrades on
    // contributor installs: install-branch carries a local commit, then the
    // operator switches to a feature branch and leaves untracked WIP behind.
    git(install, "checkout", "-b", "dpf/install");
    commit(install, "local.txt", "private feature\n", "local: feature");
    const installBranchTip = git(install, "rev-parse", "HEAD").trim();
    git(install, "checkout", "-b", "feat/operator-wip");
    writeFileSync(join(install, "wip.txt"), "uncommitted work in progress\n");
    writeFileSync(join(install, "base.txt"), "v1 + operator edit\n");

    // Upstream advances.
    commit(upstream, "upstream.txt", "shipped feature\n", "feat: upstream thing");
    const upstreamCommit = git(upstream, "rev-parse", "HEAD").trim();

    const r = await prepareUpgradeSource(
      {
        sourceMode: "upstream",
        hostSourcePath: install,
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
        workspacePath: workspace,
      },
      defaultGitRunner,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Workspace was created and holds the merged tree.
    expect(existsSync(join(workspace, ".git"))).toBe(true);
    expect(existsSync(join(workspace, "local.txt"))).toBe(true);
    expect(existsSync(join(workspace, "upstream.txt"))).toBe(true);

    // The workspace HEAD is a real merge commit with two parents (install
    // branch tip + upstream tip).
    const wsHead = git(workspace, "rev-parse", "HEAD").trim();
    expect(r.stamp).toBe(wsHead);
    expect(r.upstreamSha).toBe(upstreamCommit);
    const parents = git(workspace, "rev-list", "--parents", "-n", "1", "HEAD")
      .trim()
      .split(/\s+/)
      .slice(1);
    expect(parents).toContain(installBranchTip);
    expect(parents).toContain(upstreamCommit);

    // CRITICAL: the install clone's WORKING TREE is untouched. Operator is
    // still on the feature branch, WIP file still present, and base.txt
    // still carries their unstaged edit.
    expect(git(install, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("feat/operator-wip");
    expect(existsSync(join(install, "wip.txt"))).toBe(true);
    // CodeQL: use readFileSync rather than execFileSync("cat") — no process needed.
    const baseAfter = readFileSync(join(install, "base.txt"), "utf8");
    expect(baseAfter).toBe("v1 + operator edit\n");

    // The install clone's dpf/install ref WAS advanced (push-back happened),
    // so next upgrade starts from the new tip. Operator's working tree
    // staying on feat/operator-wip means receive.denyCurrentBranch can't
    // block this push — dpf/install is not currently checked out.
    const installRefAfter = git(install, "rev-parse", "dpf/install").trim();
    expect(installRefAfter).toBe(wsHead);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("reuses an already-initialised workspace on subsequent runs (no second clone)", async () => {
    const { upstream, install, workspace, root } = makeWorld();
    cleanup.push(root);
    git(install, "checkout", "-b", "dpf/install");
    commit(install, "local.txt", "x\n", "local");
    git(install, "checkout", "-b", "feat/operator-wip");

    // Run 1.
    commit(upstream, "u1.txt", "u1\n", "u1");
    const r1 = await prepareUpgradeSource(
      {
        sourceMode: "upstream",
        hostSourcePath: install,
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
        workspacePath: workspace,
      },
      defaultGitRunner,
    );
    expect(r1.ok).toBe(true);

    const wsGitDirInodeBefore = git(workspace, "rev-parse", "--git-dir").trim();

    // Run 2.
    commit(upstream, "u2.txt", "u2\n", "u2");
    const r2 = await prepareUpgradeSource(
      {
        sourceMode: "upstream",
        hostSourcePath: install,
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
        workspacePath: workspace,
      },
      defaultGitRunner,
    );
    expect(r2.ok).toBe(true);

    // Same workspace, advanced further.
    expect(git(workspace, "rev-parse", "--git-dir").trim()).toBe(wsGitDirInodeBefore);
    expect(existsSync(join(workspace, "u1.txt"))).toBe(true);
    expect(existsSync(join(workspace, "u2.txt"))).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("keeps an upstream-only install on the canonical upstream SHA instead of minting a local merge SHA", async () => {
    const { upstream, install, workspace, root } = makeWorld();
    cleanup.push(root);

    // The install branch has no private/local content. It merely points at the
    // upstream revision from the previous successful upgrade.
    git(install, "checkout", "-b", "dpf/install");
    git(install, "checkout", "-b", "feat/operator-wip");

    // A later release advances upstream. The safe result is a canonical
    // fast-forward to this exact commit, not an install-local --no-ff merge
    // commit that no peer or canonical preflight can fetch.
    commit(upstream, "u1.txt", "u1\n", "u1");
    const upstreamCommit = git(upstream, "rev-parse", "HEAD").trim();

    const result = await prepareUpgradeSource(
      {
        sourceMode: "upstream",
        hostSourcePath: install,
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
        workspacePath: workspace,
      },
      defaultGitRunner,
    );

    expect(result).toEqual({
      ok: true,
      mode: "upstream",
      stamp: upstreamCommit,
      upstreamSha: upstreamCommit,
    });
    expect(git(workspace, "rev-parse", "HEAD").trim()).toBe(upstreamCommit);
    expect(git(install, "rev-parse", "dpf/install").trim()).toBe(upstreamCommit);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("workspace merge that conflicts aborts cleanly and surfaces conflict files (no install-clone mutation)", async () => {
    const { upstream, install, workspace, root } = makeWorld();
    cleanup.push(root);

    git(install, "checkout", "-b", "dpf/install");
    commit(install, "shared.txt", "install variant\n", "install variant");
    // Operator goes back to main-ish branch with dirty tree, just to prove
    // the workspace is fully decoupled from it.
    git(install, "checkout", "-b", "feat/whatever");
    writeFileSync(join(install, "dirty.txt"), "dirty operator work\n");

    // Upstream changes the SAME file in an incompatible way → real conflict.
    commit(upstream, "shared.txt", "upstream variant\n", "upstream variant");

    const r = await prepareUpgradeSource(
      {
        sourceMode: "upstream",
        hostSourcePath: install,
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
        workspacePath: workspace,
      },
      defaultGitRunner,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("merge-conflict");
    if (r.reason !== "merge-conflict") return;
    expect(r.conflictFiles).toContain("shared.txt");
    expect(r.message).toContain("shared.txt".length > 0 ? "1 file" : "");

    // Workspace is clean (merge aborted, no MERGE_HEAD residue).
    expect(existsSync(join(workspace, ".git/MERGE_HEAD"))).toBe(false);
    expect(git(workspace, "status", "--porcelain").trim()).toBe("");
    // Operator's install clone is COMPLETELY untouched.
    expect(git(install, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("feat/whatever");
    expect(existsSync(join(install, "dirty.txt"))).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("captures stderr when merge fails with no conflict markers (e.g. unrelated histories) so failureLog is actionable", async () => {
    // Build a world where the install branch and upstream are unrelated
    // histories — git refuses with "refusing to merge unrelated histories"
    // and produces zero U-state files. The pre-fix failureLog was literally
    // "merge-conflict:" with no detail. After the fix, stderr is captured.
    const { upstream, install, workspace, root } = makeWorld();
    cleanup.push(root);
    // Reset the install branch to a freshly orphan-branched tree so it shares
    // NO history with upstream.
    git(install, "checkout", "--orphan", "dpf/install");
    git(install, "rm", "-rf", "--quiet", ".");
    commit(install, "alien.txt", "no shared history\n", "orphan install");

    const r = await prepareUpgradeSource(
      {
        sourceMode: "upstream",
        hostSourcePath: install,
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
        workspacePath: workspace,
      },
      defaultGitRunner,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("merge-conflict");
    if (r.reason !== "merge-conflict") return;
    expect(r.conflictFiles).toEqual([]);
    // The fix: the message tells the operator WHY when conflictFiles is empty.
    // The exact wording from git varies by version, but "unrelated histories"
    // is the canonical phrase on this code path.
    expect(r.message).toMatch(/no conflict markers/);
    expect(r.message.length).toBeGreaterThan("merge-conflict:".length);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("first-run with no install-branch on the install clone creates it from upstream tip", async () => {
    const { upstream, install, workspace, root } = makeWorld();
    cleanup.push(root);
    // Install clone has NO dpf/install branch at all — fresh install.

    commit(upstream, "shipped.txt", "shipped\n", "feat: shipped");
    const upstreamCommit = git(upstream, "rev-parse", "HEAD").trim();

    const r = await prepareUpgradeSource(
      {
        sourceMode: "upstream",
        hostSourcePath: install,
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
        workspacePath: workspace,
      },
      defaultGitRunner,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // First run: the workspace install-branch starts at the upstream tip and
    // gets merged with itself → a fast-forward equivalent (a real merge-commit
    // because we use --no-ff, with both parents pointing at the same tip).
    expect(r.upstreamSha).toBe(upstreamCommit);
    expect(existsSync(join(workspace, "shipped.txt"))).toBe(true);
    // Install clone has dpf/install now (push-back created the ref).
    const installRef = git(install, "rev-parse", "dpf/install").trim();
    expect(installRef.length).toBe(40);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("refuses with a clear message when the install clone has no upstream remote", async () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-upg-no-remote-"));
    cleanup.push(root);
    const install = join(root, "install");
    gitExec(["init", "-b", "main", install]);
    configureRepo(install);
    git(install, "config", "user.email", "t@t");
    git(install, "config", "user.name", "t");
    commit(install, "x.txt", "x\n", "x");
    const workspace = join(root, "ws");

    const r = await prepareUpgradeSource(
      {
        sourceMode: "upstream",
        hostSourcePath: install,
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
        workspacePath: workspace,
      },
      defaultGitRunner,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("prep-error");
    expect(r.message).toMatch(/no 'origin' remote/);
  }, REAL_GIT_TEST_TIMEOUT_MS);
});
