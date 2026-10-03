// M1 of the Workspace contract (W1): each build gets its own repository at
// .builds/<id>. These tests run the generated shell commands against real git
// repositories in a temp dir, the way the sandbox runs them.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSandboxBuildCloneCommand,
  buildSandboxBuildCloneRemoveCommand,
  buildSandboxBuildCloneSyncCommand,
  buildWorkspaceMode,
} from "./build-clone";

const sh = (command: string) => {
  const r = spawnSync("sh", ["-c", command], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}\n--- command ---\n${command}`);
  return r.stdout;
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

let root: string;
let shared: string;
let path: string;
const branch = "build/FB-TEST1";

function cloneCommand() {
  return buildSandboxBuildCloneCommand({
    path,
    branchRef: branch,
    workspace: shared,
    install: "true",
    commitInFlight: `{ cd '${path}' && git add -A && git commit -qm 'wip: in-flight' || true; }`,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dpf-build-clone-"));
  const upstream = join(root, "upstream.git");
  shared = join(root, "workspace");
  path = join(shared, ".builds", "FB-TEST1");
  git(root, "init", "-q", "--bare", "-b", "main", upstream);
  git(root, "init", "-q", "-b", "main", shared);
  git(shared, "config", "user.name", "dpf-agent-test");
  git(shared, "config", "user.email", "agent@example.test");
  writeFileSync(join(shared, ".gitignore"), ".builds/\n");
  writeFileSync(join(shared, "a.txt"), "base\n");
  git(shared, "add", "-A");
  git(shared, "commit", "-qm", "base");
  git(shared, "remote", "add", "origin", upstream);
  git(shared, "push", "-q", "origin", "main");
  git(shared, "fetch", "-q", "origin");
  git(shared, "checkout", "-q", "-b", "client/abc");
  git(shared, "branch", branch, "client/abc");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("build clone (W1, M1)", () => {
  it("creates an independent repository on the build branch, with the shared refs builds resolve", () => {
    sh(cloneCommand());
    expect(statSync(join(path, ".git")).isDirectory()).toBe(true);
    expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    // dissociated: no alternates file pointing back at the shared repo
    expect(existsSync(join(path, ".git", "objects", "info", "alternates"))).toBe(false);
    // origin/main and bare client/<id> resolve, as the diff base and merge base need
    expect(git(path, "rev-parse", "origin/main")).toBe(git(shared, "rev-parse", "origin/main"));
    expect(git(path, "rev-parse", "client/abc")).toBe(git(shared, "rev-parse", "client/abc"));
    // commit identity and upstream remote carried over
    expect(git(path, "config", "user.name")).toBe("dpf-agent-test");
    expect(git(path, "remote", "get-url", "origin")).toBe(git(shared, "remote", "get-url", "origin"));
    expect(git(path, "config", "core.hooksPath")).toBe("/dev/null");
  });

  it("records the build's commits in the shared repo before deleting the clone", () => {
    sh(cloneCommand());
    writeFileSync(join(path, "feature.txt"), "work\n");
    git(path, "add", "-A");
    git(path, "commit", "-qm", "feature");
    const head = git(path, "rev-parse", "HEAD");
    sh(buildSandboxBuildCloneRemoveCommand(path, branch, shared));
    expect(existsSync(path)).toBe(false);
    expect(git(shared, "rev-parse", branch)).toBe(head);
  });

  it("lets the shared repo merge what the clone committed once synced (promotion)", () => {
    sh(cloneCommand());
    writeFileSync(join(path, "feature.txt"), "work\n");
    git(path, "add", "-A");
    git(path, "commit", "-qm", "feature");
    sh(buildSandboxBuildCloneSyncCommand(path, branch));
    git(shared, "merge", "-q", "--no-ff", branch, "-m", "promote");
    expect(git(shared, "show", "HEAD:feature.txt")).toBe("work");
  });

  it("reuses a clone already on the build branch without losing uncommitted work", () => {
    sh(cloneCommand());
    writeFileSync(join(path, "draft.txt"), "uncommitted\n");
    sh(cloneCommand());
    expect(existsSync(join(path, "draft.txt"))).toBe(true);
  });

  it("converts a worktree from the previous mode, keeping its in-flight work", () => {
    git(shared, "worktree", "add", "-q", path, branch);
    writeFileSync(join(path, "inflight.txt"), "from the worktree\n");
    sh(cloneCommand());
    expect(statSync(join(path, ".git")).isDirectory()).toBe(true);
    expect(git(path, "show", "HEAD:inflight.txt")).toBe("from the worktree");
    expect(git(shared, "worktree", "list")).not.toContain(".builds");
  });

  it("is a no-op sync for a path that is not a clone on the branch", () => {
    expect(() => sh(buildSandboxBuildCloneSyncCommand(join(root, "missing"), branch))).not.toThrow();
  });
});

describe("buildWorkspaceMode", () => {
  it("defaults to clone; worktree is the rollback", () => {
    const prev = process.env.DPF_BUILD_WORKSPACE_MODE;
    delete process.env.DPF_BUILD_WORKSPACE_MODE;
    expect(buildWorkspaceMode()).toBe("clone");
    process.env.DPF_BUILD_WORKSPACE_MODE = "worktree";
    expect(buildWorkspaceMode()).toBe("worktree");
    if (prev === undefined) delete process.env.DPF_BUILD_WORKSPACE_MODE;
    else process.env.DPF_BUILD_WORKSPACE_MODE = prev;
  });
});
