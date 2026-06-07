import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareUpgradeSource, defaultGitRunner } from "./prepare-source";

// Functional proof: exercise the REAL git runner against REAL repos. No mocks.
// This is the evidence that the merge actually preserves local commits and that
// a conflict is aborted to a clean tree rather than left mid-merge.

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
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", "-A");
  git(cwd, "-c", "commit.gpgsign=false", "commit", "-m", msg);
}

/** upstream repo (on main) + an install clone with a dpf/install branch. */
function makeWorld(): { upstream: string; install: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "dpf-upg-"));
  const upstream = join(root, "upstream");
  const install = join(root, "install");
  gitExec(["init", "-b", "main", upstream]);
  configureRepo(upstream);
  commit(upstream, "base.txt", "v1\n", "base");
  gitExec(["-c", "core.autocrlf=false", "-c", "core.eol=lf", "clone", "-q", upstream, install]);
  configureRepo(install);
  git(install, "config", "user.email", "t@t");
  git(install, "config", "user.name", "t");
  return { upstream, install, root };
}

describe.skipIf(!GIT_AVAILABLE)("prepareUpgradeSource — real git", () => {
  const cleanup: string[] = [];
  beforeAll(() => {
    return () => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true }));
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("merges upstream into the install branch, PRESERVING local commits", async () => {
    const { upstream, install, root } = makeWorld();
    cleanup.push(root);

    // Local customization on the durable install branch (never pushed upstream).
    git(install, "checkout", "-b", "dpf/install");
    commit(install, "local.txt", "my private feature\n", "local: feature");
    const localCommit = git(install, "rev-parse", "HEAD").trim();

    // Upstream advances with a new feature on a disjoint file.
    commit(upstream, "upstream.txt", "new upstream feature\n", "feat: upstream thing");
    const upstreamCommit = git(upstream, "rev-parse", "HEAD").trim();

    const r = await prepareUpgradeSource(
      { sourceMode: "upstream", hostSourcePath: install, remote: "origin", branch: "main", installBranch: "dpf/install" },
      defaultGitRunner,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const head = git(install, "rev-parse", "HEAD").trim();
    // Stamp is the real merge-commit identity.
    expect(r.stamp).toBe(head);
    expect(r.upstreamSha).toBe(upstreamCommit);
    // It is a real merge commit (two parents): one is the local commit, the
    // other carries the upstream change.
    const parents = git(install, "rev-list", "--parents", "-n", "1", "HEAD").trim().split(/\s+/).slice(1);
    expect(parents).toContain(localCommit);
    expect(parents).toContain(upstreamCommit);
    // BOTH the local customization AND the upstream feature are present — the
    // whole point: stay current without losing local work.
    expect(existsSync(join(install, "local.txt"))).toBe(true);
    expect(existsSync(join(install, "upstream.txt"))).toBe(true);
    // We are on the install branch, clean.
    expect(git(install, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("dpf/install");
    expect(git(install, "status", "--porcelain").trim()).toBe("");
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("creates the install branch from HEAD on first run when it is absent", async () => {
    const { upstream, install, root } = makeWorld();
    cleanup.push(root);
    commit(upstream, "upstream.txt", "x\n", "feat: x");

    const r = await prepareUpgradeSource(
      { sourceMode: "upstream", hostSourcePath: install, remote: "origin", branch: "main", installBranch: "dpf/install" },
      defaultGitRunner,
    );

    expect(r.ok).toBe(true);
    expect(git(install, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("dpf/install");
    expect(existsSync(join(install, "upstream.txt"))).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("ABORTS to a clean tree on a real conflict and reports the file", async () => {
    const { upstream, install, root } = makeWorld();
    cleanup.push(root);

    // Local and upstream both edit the same file → genuine merge conflict.
    git(install, "checkout", "-b", "dpf/install");
    commit(install, "base.txt", "local edit\n", "local: edit base");
    const beforeHead = git(install, "rev-parse", "HEAD").trim();
    commit(upstream, "base.txt", "upstream edit\n", "fix: edit base");

    const r = await prepareUpgradeSource(
      { sourceMode: "upstream", hostSourcePath: install, remote: "origin", branch: "main", installBranch: "dpf/install" },
      defaultGitRunner,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("merge-conflict");
    if (r.reason !== "merge-conflict") return;
    expect(r.conflictFiles).toContain("base.txt");
    // Critically: the clone is NOT left mid-merge — it was aborted clean.
    expect(existsSync(join(install, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(install, "status", "--porcelain").trim()).toBe("");
    expect(git(install, "rev-parse", "HEAD").trim()).toBe(beforeHead);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("survives a hard-failing post-checkout hook (e.g. Git LFS hook with no git-lfs binary)", async () => {
    const { upstream, install, root } = makeWorld();
    cleanup.push(root);
    commit(upstream, "upstream.txt", "x\n", "feat: x");

    // Reproduce the Mac/container blocker: the clone has a post-checkout hook
    // that exits non-zero (the git-lfs hook does exactly this when git-lfs is
    // absent). Without hook-bypassing, `git checkout` returns non-zero and prep
    // would abort with prep-error even though the checkout itself succeeds.
    const hooksDir = join(install, ".dpf-hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hook = join(hooksDir, "post-checkout");
    writeFileSync(hook, "#!/bin/sh\necho 'git-lfs not found' >&2\nexit 2\n");
    chmodSync(hook, 0o755);
    git(install, "config", "core.hooksPath", hooksDir);

    const r = await prepareUpgradeSource(
      { sourceMode: "upstream", hostSourcePath: install, remote: "origin", branch: "main", installBranch: "dpf/install" },
      defaultGitRunner,
    );

    expect(r.ok).toBe(true);
    expect(git(install, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("dpf/install");
    expect(existsSync(join(install, "upstream.txt"))).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("refuses up front on an uncommitted working tree (does not switch branch or merge)", async () => {
    const { upstream, install, root } = makeWorld();
    cleanup.push(root);
    commit(upstream, "upstream.txt", "x\n", "feat: x");

    // Uncommitted local change in the install clone — the real-world case
    // (e.g. WIP edits). The merge would otherwise abort with "local changes
    // would be overwritten" and surface as an empty, misleading merge-conflict.
    const startBranch = git(install, "rev-parse", "--abbrev-ref", "HEAD").trim();
    writeFileSync(join(install, "base.txt"), "uncommitted edit\n");

    const r = await prepareUpgradeSource(
      { sourceMode: "upstream", hostSourcePath: install, remote: "origin", branch: "main", installBranch: "dpf/install" },
      defaultGitRunner,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("dirty-tree");
    expect(r.message).toContain("base.txt");
    expect(r.message).toContain("uncommitted");
    // The clone is untouched: still on the original branch, never switched to
    // the install branch, no merge in progress.
    expect(git(install, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(startBranch);
    expect(existsSync(join(install, ".git", "MERGE_HEAD"))).toBe(false);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("local mode stamps the working tree HEAD, with -dirty when uncommitted", async () => {
    const { install, root } = makeWorld();
    cleanup.push(root);

    const clean = await prepareUpgradeSource(
      { sourceMode: "local", hostSourcePath: install, remote: "origin", branch: "main", installBranch: "dpf/install" },
      defaultGitRunner,
    );
    expect(clean.ok).toBe(true);
    if (clean.ok) expect(clean.stamp).toBe(git(install, "rev-parse", "HEAD").trim());

    writeFileSync(join(install, "base.txt"), "uncommitted change\n");
    const dirty = await prepareUpgradeSource(
      { sourceMode: "local", hostSourcePath: install, remote: "origin", branch: "main", installBranch: "dpf/install" },
      defaultGitRunner,
    );
    expect(dirty.ok).toBe(true);
    if (dirty.ok) expect(dirty.stamp.endsWith("-dirty")).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);
});
