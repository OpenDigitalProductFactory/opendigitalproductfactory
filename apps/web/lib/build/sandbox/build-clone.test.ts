// M1 of the Workspace contract (W1): each build gets its own repository at
// .builds/<id>. These tests run the generated shell commands against real git
// repositories in a temp dir, the way the sandbox runs them.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSandboxBuildCloneAlignCommand,
  buildSandboxBuildCloneCommand,
  buildSandboxBuildCloneRebaseCommand,
  buildSandboxPublishedHeadFetchCommand,
  buildSandboxBuildCloneRemoveCommand,
  buildSandboxBuildCloneSyncCommand,
  buildWorkspaceMode,
  parseBuildCloneAlignOutput,
  parseBuildCloneRebaseOutput,
  publishedHeadRef,
} from "./build-clone";

// These are POSIX commands for the Linux sandbox. On a Windows host, hand `sh`
// forward-slash paths (backslashes would be read as escapes) and stop Git for
// Windows rewriting literal POSIX arguments such as /dev/null to `nul`.
const posix = (p: string) => p.replace(/\\/g, "/");
const sh = (command: string) => {
  const r = spawnSync("sh", ["-c", command], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
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
    path: posix(path),
    branchRef: branch,
    workspace: posix(shared),
    install: "true",
    commitInFlight: `{ cd '${posix(path)}' && git add -A && git commit -qm 'wip: in-flight' || true; }`,
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

// Each case runs real git (clone, rebase, hooks) through sh: 9-14 s on a
// Windows host, so the default 15 s budget times out under a parallel gate run.
// The budget measures a hang, not host speed (BI-F25D7E88).
const GIT_FIXTURE_TIMEOUT_MS = 60_000;

describe("build clone (W1, M1)", { timeout: GIT_FIXTURE_TIMEOUT_MS }, () => {
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
    sh(buildSandboxBuildCloneRemoveCommand(posix(path), branch, posix(shared)));
    expect(existsSync(path)).toBe(false);
    expect(git(shared, "rev-parse", branch)).toBe(head);
  });

  it("lets the shared repo merge what the clone committed once synced (promotion)", () => {
    sh(cloneCommand());
    writeFileSync(join(path, "feature.txt"), "work\n");
    git(path, "add", "-A");
    git(path, "commit", "-qm", "feature");
    sh(buildSandboxBuildCloneSyncCommand(posix(path), branch));
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

  // FB-91774D92 (2026-10-08): the repo's postinstall (scripts/set-hooks-path.mjs)
  // re-points core.hooksPath at .githooks AFTER the clone's config set /dev/null.
  // On the next re-ensure the platform's own push into the shared repo ran the
  // contributor pre-push gate, which refused it, and the build failed at start.
  it("syncs the branch even when an install re-pointed the clone's hooks at a refusing pre-push hook", () => {
    sh(cloneCommand());
    writeFileSync(join(path, "feature.txt"), "work\n");
    git(path, "add", "-A");
    git(path, "commit", "-qm", "feature");
    const hooks = join(root, "hooks");
    execFileSync("mkdir", ["-p", hooks]);
    writeFileSync(join(hooks, "pre-push"), "#!/bin/sh\necho '[pre-push-gate] Run the sandbox gate first' >&2\nexit 1\n", { mode: 0o755 });
    git(path, "config", "core.hooksPath", hooks);

    sh(buildSandboxBuildCloneSyncCommand(posix(path), branch));
    expect(git(shared, "rev-parse", branch)).toBe(git(path, "rev-parse", "HEAD"));
    expect(() => sh(cloneCommand())).not.toThrow();
  });

  it("is a no-op sync for a path that is not a clone on the branch", () => {
    expect(() => sh(buildSandboxBuildCloneSyncCommand(join(root, "missing"), branch))).not.toThrow();
  });
});

// BI-76BD65E6: a build that waited at ship while main moved on is rebased onto
// the refreshed client branch before its PR is published.
describe("build clone rebase onto a moved client branch", { timeout: GIT_FIXTURE_TIMEOUT_MS }, () => {
  function moveClient(file: string, content: string) {
    git(shared, "checkout", "-q", "client/abc");
    writeFileSync(join(shared, file), content);
    git(shared, "add", "-A");
    git(shared, "commit", "-qm", `upstream ${file}`);
  }
  function commitInClone(file: string, content: string) {
    writeFileSync(join(path, file), content);
    git(path, "add", "-A");
    git(path, "commit", "-qm", `build ${file}`);
  }

  it("replays the build's commits on top of the client branch and reports the new head", () => {
    sh(cloneCommand());
    commitInClone("feature.txt", "work\n");
    moveClient("upstream.txt", "moved on\n");
    sh(cloneCommand()); // re-ensure: the clone sees the moved client/abc

    const out = parseBuildCloneRebaseOutput(sh(buildSandboxBuildCloneRebaseCommand(posix(path), "client/abc")));
    expect(out).toEqual({ status: "ok", headSha: git(path, "rev-parse", "HEAD") });
    expect(git(path, "merge-base", "HEAD", "client/abc")).toBe(git(path, "rev-parse", "client/abc"));
    expect(git(path, "show", "HEAD:feature.txt")).toBe("work");
    expect(git(path, "show", "HEAD:upstream.txt")).toBe("moved on");
  });

  it("aborts on a conflict, names the files and leaves the branch exactly as it was", () => {
    sh(cloneCommand());
    commitInClone("a.txt", "build edit\n");
    const before = git(path, "rev-parse", "HEAD");
    moveClient("a.txt", "upstream edit\n");
    sh(cloneCommand());

    const out = parseBuildCloneRebaseOutput(sh(buildSandboxBuildCloneRebaseCommand(posix(path), "client/abc")));
    expect(out).toEqual({ status: "conflict", files: ["a.txt"] });
    expect(git(path, "rev-parse", "HEAD")).toBe(before);
    expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(git(path, "status", "--porcelain")).toBe("");
  });

  it("is not stopped by a refusing hook the install re-pointed the clone at", () => {
    sh(cloneCommand());
    commitInClone("feature.txt", "work\n");
    moveClient("upstream.txt", "moved on\n");
    sh(cloneCommand());
    const hooks = join(root, "hooks");
    execFileSync("mkdir", ["-p", hooks]);
    writeFileSync(join(hooks, "pre-rebase"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    git(path, "config", "core.hooksPath", hooks);

    expect(parseBuildCloneRebaseOutput(sh(buildSandboxBuildCloneRebaseCommand(posix(path), "client/abc"))).status).toBe("ok");
  });

  it("reads an unrecognised output as unknown rather than success", () => {
    expect(parseBuildCloneRebaseOutput("rebase=ok\nhead=\n").status).toBe("unknown");
    expect(parseBuildCloneRebaseOutput("").status).toBe("unknown");
  });
});

// BI-C49EC080: the PR head is a commit the GitHub API minted (the build's files
// over main), not the clone's own commit. The clone is put on that exact commit
// so review binds the commit Failure Readiness checks.
describe("build clone alignment to the published PR commit", { timeout: GIT_FIXTURE_TIMEOUT_MS }, () => {
  const ref = publishedHeadRef("FB-TEST1");

  /** Publish like publishBranchCommit: one commit on upstream main carrying the build's file. */
  function publishOnUpstream(parentRef: string): string {
    const pub = join(root, "publisher");
    git(root, "clone", "-q", join(root, "upstream.git"), pub);
    git(pub, "config", "user.name", "dpf-agent-test");
    git(pub, "config", "user.email", "agent@example.test");
    git(pub, "checkout", "-q", "--detach", parentRef);
    writeFileSync(join(pub, "feature.txt"), "published\n");
    git(pub, "add", "-A");
    git(pub, "commit", "-qm", "feat: published");
    const sha = git(pub, "rev-parse", "HEAD");
    git(pub, "push", "-q", "origin", "HEAD:refs/heads/dpf/abc/feature");
    return sha;
  }

  function fetchPublished(sha: string) {
    sh(buildSandboxPublishedHeadFetchCommand(posix(shared), sha, ref));
  }

  it("puts the build branch on the published commit, whose parent is the diff base", () => {
    sh(cloneCommand());
    writeFileSync(join(path, "feature.txt"), "sandbox\n");
    git(path, "add", "-A");
    git(path, "commit", "-qm", "build feature");
    const sha = publishOnUpstream("origin/main");
    fetchPublished(sha);

    const out = parseBuildCloneAlignOutput(sh(buildSandboxBuildCloneAlignCommand(posix(path), ref, sha, "client/abc")));
    expect(out).toEqual({ status: "aligned", headSha: sha });
    expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(git(path, "rev-parse", "HEAD")).toBe(sha);
    expect(git(path, "merge-base", "HEAD", "client/abc")).toBe(git(path, "rev-parse", `${sha}^`));
    expect(git(path, "show", "HEAD:feature.txt")).toBe("published");
  });

  it("refuses a published commit whose parent the client branch does not contain", () => {
    const pub = join(root, "mover");
    git(root, "clone", "-q", join(root, "upstream.git"), pub);
    git(pub, "config", "user.name", "dpf-agent-test");
    git(pub, "config", "user.email", "agent@example.test");
    writeFileSync(join(pub, "upstream.txt"), "main moved\n");
    git(pub, "add", "-A");
    git(pub, "commit", "-qm", "main moved");
    git(pub, "push", "-q", "origin", "main");
    sh(cloneCommand());
    const before = git(path, "rev-parse", "HEAD");
    const sha = publishOnUpstream("origin/main");
    fetchPublished(sha);

    const out = parseBuildCloneAlignOutput(sh(buildSandboxBuildCloneAlignCommand(posix(path), ref, sha, "client/abc")));
    expect(out.status).toBe("base-not-on-target");
    expect(git(path, "rev-parse", "HEAD")).toBe(before);
  });

  it("refuses to discard uncommitted tracked work", () => {
    sh(cloneCommand());
    const sha = publishOnUpstream("origin/main");
    fetchPublished(sha);
    writeFileSync(join(path, "a.txt"), "uncommitted\n");
    const before = git(path, "rev-parse", "HEAD");

    expect(parseBuildCloneAlignOutput(sh(buildSandboxBuildCloneAlignCommand(posix(path), ref, sha, "client/abc"))).status).toBe("dirty");
    expect(git(path, "rev-parse", "HEAD")).toBe(before);
  });

  it("refuses when the shared ref does not hold the published commit", () => {
    sh(cloneCommand());
    const sha = publishOnUpstream("origin/main");
    expect(parseBuildCloneAlignOutput(sh(buildSandboxBuildCloneAlignCommand(posix(path), ref, sha, "client/abc"))).status).toBe("unfetched");
    git(shared, "update-ref", ref, git(shared, "rev-parse", "main"));
    expect(parseBuildCloneAlignOutput(sh(buildSandboxBuildCloneAlignCommand(posix(path), ref, sha, "client/abc"))).status).toBe("mismatch");
  });

  it("reads an unrecognised output as unknown, and refuses a malformed sha", () => {
    expect(parseBuildCloneAlignOutput("align=ok\nhead=\n").status).toBe("unknown");
    expect(parseBuildCloneAlignOutput("").status).toBe("unknown");
    expect(() => buildSandboxBuildCloneAlignCommand("/w", ref, "abc; rm -rf /", "client/abc")).toThrow();
    expect(() => buildSandboxPublishedHeadFetchCommand("/w", "HEAD", ref)).toThrow();
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
