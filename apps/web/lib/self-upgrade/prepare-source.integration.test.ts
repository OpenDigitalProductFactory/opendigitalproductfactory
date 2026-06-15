import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
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

  it("REFUSES an upstream merge without an isolated workspace, leaving the host clone untouched (legacy direct-merge retired, BI-4043A64B)", async () => {
    const { upstream, install, root } = makeWorld();
    cleanup.push(root);

    // Local customization on the durable install branch (never pushed upstream).
    git(install, "checkout", "-b", "dpf/install");
    commit(install, "local.txt", "my private feature\n", "local: feature");
    const startBranch = git(install, "rev-parse", "--abbrev-ref", "HEAD").trim();
    const startHead = git(install, "rev-parse", "HEAD").trim();

    // Upstream advances; a legacy direct-merge would have pulled this into the
    // host working tree (and an interrupted run could corrupt it).
    commit(upstream, "upstream.txt", "new upstream feature\n", "feat: upstream thing");

    // No workspacePath → the retired legacy path. It must refuse, not merge.
    const r = await prepareUpgradeSource(
      { sourceMode: "upstream", hostSourcePath: install, remote: "origin", branch: "main", installBranch: "dpf/install" },
      defaultGitRunner,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("prep-error");
    expect(r.message).toMatch(/isolated workspace/i);

    // The PROOF: the host clone's working tree is never mutated — same branch,
    // same HEAD, no merge in progress, no upstream file pulled in, clean status.
    // This is the corruption path (721-file loss, 2026-06-15) being closed.
    expect(git(install, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(startBranch);
    expect(git(install, "rev-parse", "HEAD").trim()).toBe(startHead);
    expect(existsSync(join(install, ".git", "MERGE_HEAD"))).toBe(false);
    expect(existsSync(join(install, "upstream.txt"))).toBe(false);
    expect(git(install, "status", "--porcelain").trim()).toBe("");
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
