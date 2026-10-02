// apps/web/lib/build/sandbox/build-clone.ts
//
// Workspace contract W1 (docs/superpowers/specs/2026-05-09-build-execution-provider-design.md,
// "Workspace contract", ratified 2026-10-01), migration step M1: each build gets
// its own repository instead of a git worktree of the shared /workspace repo.
// About 25 of 41 sandbox defects (2026-08-01 to 2026-09-29) trace to builds
// sharing one index, one shallow file, one ref store and one worktree registry.
//
// The clone sits at the same path as the worktree did (.builds/<buildId>), so
// every caller that resolves a build's workdir is unchanged. It is created with
// `git clone --reference <shared> --dissociate`: objects are borrowed at
// creation and the clone never depends on the shared repo afterwards.
//
// The shared repo stays the one place every build branch is RECORDED. Branch
// promotion, branch GC and "keep the branch for audit" all read it there, so
// the clone pushes its branch back (remote "shared") before anything that
// reads it: promotion, teardown, and every re-ensure. Without that, teardown
// would delete the only copy of an abandoned build's commits.
//
// Behind DPF_BUILD_WORKSPACE_MODE=clone until verified on the live install;
// the default stays "worktree".

/** How a build's workspace is materialized. */
export type BuildWorkspaceMode = "worktree" | "clone";

export function buildWorkspaceMode(): BuildWorkspaceMode {
  return process.env.DPF_BUILD_WORKSPACE_MODE?.trim().toLowerCase() === "clone" ? "clone" : "worktree";
}

/** The clone's remote for the shared /workspace repo. `origin` stays the upstream (GitHub) URL. */
export const SHARED_REMOTE = "shared";

const q = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Push the clone's build branch back into the shared repo, so the branch is
 * recorded there for promotion, GC and audit. No-op unless `path` is a clone
 * (a `.git` directory, not a worktree's gitlink file) on `branchRef`.
 */
export function buildSandboxBuildCloneSyncCommand(path: string, branchRef: string): string {
  return `if [ -d ${q(`${path}/.git`)} ] && [ "$(git -C ${q(path)} rev-parse --abbrev-ref HEAD 2>/dev/null)" = ${q(branchRef)} ]; then git -C ${q(path)} push --quiet --force ${SHARED_REMOTE} ${q(`HEAD:refs/heads/${branchRef}`)}; fi`;
}

/**
 * Create (or reuse) a build's own repository at `path`, on `branchRef`, which
 * must already exist in the shared repo at `workspace`.
 *
 * - Reuse: the path is a clone on the build's branch. Its branch is synced
 *   back, its view of the shared refs refreshed, and its config and install
 *   re-asserted.
 * - Recreate: anything else at the path (a worktree from the previous mode, a
 *   clone that drifted, an orphaned directory) is replaced. A worktree on the
 *   build's branch first commits its in-flight work, which then lives on the
 *   shared branch ref the new clone checks out.
 *
 * `install` is the caller's idempotent dependency install for `path`;
 * `commitInFlight` commits a build tree's uncommitted source (both from
 * build-branch.ts, passed in to keep this module import-free).
 */
export function buildSandboxBuildCloneCommand(args: {
  path: string;
  branchRef: string;
  workspace: string;
  install: string;
  commitInFlight: string;
}): string {
  const { path, branchRef, workspace, install, commitInFlight } = args;
  const P = q(path);
  const W = q(workspace);
  // Identity and hooks are repo-local on the shared repo and a clone does not
  // inherit them: without user.name/email a root commit fails, and the
  // in-flight commit's `|| true` would then drop the work silently.
  const config = [
    `git -C ${P} config user.name "$(git -C ${W} config user.name)"`,
    `git -C ${P} config user.email "$(git -C ${W} config user.email)"`,
    `git -C ${P} config core.hooksPath /dev/null`,
    // origin = the upstream URL, so `git fetch origin main` in the build tree
    // reaches the same remote it did as a worktree.
    `{ _dpf_up="$(git -C ${W} remote get-url origin 2>/dev/null)"; [ -z "$_dpf_up" ] || git -C ${P} remote get-url origin >/dev/null 2>&1 || git -C ${P} remote add origin "$_dpf_up"; }`,
  ].join(" && ");
  // A clone copies only the source's refs/heads. Builds resolve `origin/main`
  // (merge base, readiness, guards) and bare `client/<id>` (diff base), which
  // live in the shared repo as remote-tracking and local branches.
  const refresh = `git -C ${P} fetch --quiet --no-tags ${SHARED_REMOTE} '+refs/remotes/origin/*:refs/remotes/origin/*' '+refs/heads/client/*:refs/heads/client/*'`;
  const reuse = [
    buildSandboxBuildCloneSyncCommand(path, branchRef),
    refresh,
    config,
    install,
  ].join(" && ");
  const recreate = [
    // A worktree from the previous mode: keep its uncommitted work on the branch.
    `if [ -f ${q(`${path}/.git`)} ] && [ "$(git -C ${P} rev-parse --abbrev-ref HEAD 2>/dev/null)" = ${q(branchRef)} ]; then ${commitInFlight}; fi`,
    `cd ${W}`,
    `{ git worktree remove --force --force ${P} 2>/dev/null || true; }`,
    `rm -rf ${P}`,
    `git worktree prune`,
    `git clone --quiet --no-checkout --reference ${W} --dissociate --origin ${SHARED_REMOTE} ${W} ${P}`,
    `git -C ${P} checkout --quiet -B ${q(branchRef)} ${q(`${SHARED_REMOTE}/${branchRef}`)}`,
    refresh,
    config,
    install,
  ].join(" && ");
  return `if [ -d ${q(`${path}/.git`)} ] && [ "$(git -C ${P} rev-parse --abbrev-ref HEAD 2>/dev/null)" = ${q(branchRef)} ]; then ${reuse}; else ${recreate}; fi`;
}

/** Sync the branch back, then delete the clone. Best-effort, like the worktree removal it replaces. */
export function buildSandboxBuildCloneRemoveCommand(path: string, branchRef: string, workspace: string): string {
  return [
    `{ ${buildSandboxBuildCloneSyncCommand(path, branchRef)}; } || true`,
    `cd ${q(workspace)}`,
    `{ git worktree remove --force --force ${q(path)} 2>/dev/null || true; }`,
    `rm -rf ${q(path)}`,
    `git worktree prune`,
  ].join(" && ");
}
