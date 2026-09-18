// Regression tests for BI-062F5687: a git fixture spawned from a linked-worktree
// hook must never operate on the real repository.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { GIT_REPO_LOCATION_ENV, scrubGitRepoLocationEnv } from "./git-hook-env.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("scrubGitRepoLocationEnv drops every repository-locating variable and keeps the rest", () => {
  const input = {
    PATH: "/usr/bin",
    GIT_DIR: "/real/.git/worktrees/x",
    GIT_WORK_TREE: "/real",
    GIT_INDEX_FILE: "/real/.git/index",
    GIT_COMMON_DIR: "/real/.git",
    GIT_PREFIX: "",
    GIT_AUTHOR_NAME: "keep me",
    GIT_EXEC_PATH: "/usr/libexec/git-core",
  };
  const out = scrubGitRepoLocationEnv(input);
  for (const name of GIT_REPO_LOCATION_ENV) assert.equal(name in out, false, name);
  assert.equal(out.PATH, "/usr/bin");
  assert.equal(out.GIT_AUTHOR_NAME, "keep me");
  assert.equal(out.GIT_EXEC_PATH, "/usr/libexec/git-core");
  assert.equal(input.GIT_DIR, "/real/.git/worktrees/x", "input must not be mutated");
});

test("scrubbed env lets a temp-dir `git add -A` see the temp dir, not the inherited GIT_DIR repo", () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-git-hook-env-"));
  try {
    const real = join(root, "real");
    const fixture = join(root, "fixture");
    const identity = {
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
    };
    const git = (cwd, args, env) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...env, ...identity } }).trim();
    git(root, ["init", "-q", real]);
    execFileSync("sh", ["-c", "echo keep > tracked.txt"], { cwd: real });
    git(real, ["add", "-A"], process.env);
    git(real, ["commit", "-q", "-m", "real base"], process.env);
    const head = git(real, ["rev-parse", "HEAD"], process.env);

    // The hook environment a linked worktree hands its children.
    const hookEnv = { ...process.env, GIT_DIR: join(real, ".git") };

    git(root, ["init", "-q", fixture], scrubGitRepoLocationEnv(hookEnv));
    execFileSync("sh", ["-c", "echo fixture > f.txt"], { cwd: fixture });
    git(fixture, ["add", "-A"], scrubGitRepoLocationEnv(hookEnv));
    git(fixture, ["commit", "-q", "-m", "base"], scrubGitRepoLocationEnv(hookEnv));

    assert.equal(git(real, ["rev-parse", "HEAD"], process.env), head, "real repo HEAD must not move");
    assert.equal(git(real, ["status", "--porcelain"], process.env), "", "real repo must stay clean");
    assert.equal(git(fixture, ["log", "--format=%s", "-1"], scrubGitRepoLocationEnv(hookEnv)), "base");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the janitor freshness fixture no longer commits to a GIT_DIR it inherited (BI-062F5687)", () => {
  // The exact guard that deleted the tree under `git push`: run it the way the
  // pre-push hook of a linked worktree does — with GIT_DIR pointing at a real
  // repository — and prove that repository is untouched afterwards.
  const root = mkdtempSync(join(tmpdir(), "dpf-freshness-hookenv-"));
  try {
    const real = join(root, "real");
    const identity = {
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
    };
    const git = (args) => execFileSync("git", args, { cwd: real, encoding: "utf8", env: { ...process.env, ...identity } }).trim();
    execFileSync("git", ["init", "-q", real], { env: process.env });
    execFileSync("sh", ["-c", "echo keep > tracked.txt"], { cwd: real });
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "real base"]);
    const head = git(["rev-parse", "HEAD"]);

    const run = spawnSync(process.execPath, ["--test", "scripts/hooks/worktree-freshness.test.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_DIR: join(real, ".git") },
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.equal(git(["rev-parse", "HEAD"]), head, "the guard must not move the inherited repository's HEAD");
    assert.equal(git(["status", "--porcelain"]), "", "the guard must leave the inherited repository clean");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
