// BI-37A1349E: a build's recorded commits are its own. Live 2026-09-29, builds
// carried 18–50 upstream main commits each (merged into the build branch) plus
// the platform's "sandbox baseline" / "chore: untrack…" commits, so "builds with
// commits" counted builds with no agent work at all.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildOwnCommitsLogCommand, ownBuildCommitHashes } from "./sandbox";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string, file: string, msg: string) => {
  writeFileSync(join(cwd, file), `${msg}\n`);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", msg);
  return git(cwd, "rev-parse", "HEAD");
};

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dpf-commit-list-"));
  const upstream = join(root, "upstream.git");
  repo = join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", upstream);
  git(root, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@example.test");
  commit(repo, "a.txt", "base");
  git(repo, "remote", "add", "origin", upstream);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "checkout", "-q", "-b", "client/c1");
  commit(repo, "baseline.txt", "sandbox baseline");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the build's own commits", () => {
  it("excludes upstream main commits merged into the build branch and the platform's housekeeping", () => {
    git(repo, "checkout", "-q", "-b", "build/FB-1", "client/c1");
    commit(repo, "untrack.txt", "chore: untrack sandbox generated artifacts on build/FB-1");
    const agent = commit(repo, "feature.ts", "feat: the build's change");
    const wip = commit(repo, "more.ts", "wip: preserve in-flight build work before branch switch");
    // Upstream moves on, and the build branch merges it in.
    git(repo, "checkout", "-q", "main");
    commit(repo, "up1.txt", "feat: someone else's change (#5533)");
    commit(repo, "up2.txt", "fix: another upstream change (#5554)");
    git(repo, "push", "-q", "origin", "main");
    git(repo, "fetch", "-q", "origin");
    git(repo, "checkout", "-q", "build/FB-1");
    git(repo, "merge", "-q", "--no-edit", "origin/main");

    const out = spawnSync("sh", ["-c", buildOwnCommitsLogCommand(repo, "client/c1")], { encoding: "utf8" });
    expect(out.status).toBe(0);
    expect(new Set(ownBuildCommitHashes(out.stdout))).toEqual(new Set([agent, wip]));
  });

  it("still lists the build's commits when origin/main is not available", () => {
    git(repo, "remote", "remove", "origin");
    git(repo, "checkout", "-q", "-b", "build/FB-2", "client/c1");
    const agent = commit(repo, "x.ts", "feat: x");
    const out = spawnSync("sh", ["-c", buildOwnCommitsLogCommand(repo, "client/c1")], { encoding: "utf8" });
    expect(ownBuildCommitHashes(out.stdout)).toEqual([agent]);
  });
});
