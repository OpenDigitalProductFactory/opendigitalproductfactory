#!/usr/bin/env node
/**
 * BI-1ADD56FC — never depth-limit a fetch into a shared Git object store.
 *
 * A `git fetch --depth=1` (or --shallow-since) against a full clone writes
 * `.git/shallow`, disconnects linked worktrees from merge-base history, and
 * produces "refusing to merge unrelated histories" across every worktree that
 * shares the object store. CI gate scripts used to do this casually while
 * agents also ran those scripts from shared worktrees.
 *
 * Rules:
 *  1. Prefer a normal `git fetch --no-tags origin main` (no depth).
 *  2. Only allow depth when the caller opts in AND the repo is already shallow
 *     (typical GITHUB_ACTIONS checkout) — never convert a full repo to shallow.
 *  3. `assertRepoNotShallow` fails loud for shared root / multi-worktree clones.
 */

import { gitText } from "./git.mjs";
import { realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { acquireLocalConvergenceLock, releaseLocalConvergenceLock } from "./local-convergence-lock.mjs";

import { isEntryModule } from "./entry-module.mjs";

/**
 * @param {(args: string[]) => string} git  — exec wrapper returning stdout
 * @returns {boolean}
 */
export function isShallowRepository(git) {
  try {
    return git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    return false;
  }
}

export const SHALLOW_DEEPEN_STEP = 50;
export const SHALLOW_DEEPEN_MAX_STEPS = 10;

/** BI-PIR-08c116e7: linked worktrees share refs, so lock their common Git dir.
 * Never reclaim foreign owners: host/container PID namespaces may differ.
 * Callbacks are synchronous, like the Git runners used by these helpers.
 */
export function withSharedGitFetchLock(git, operation, opts = {}) {
  const timeoutMs = opts.lockTimeoutMs ?? 60_000;
  const pollMs = opts.lockPollMs ?? 50;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000
    || !Number.isFinite(pollMs) || pollMs <= 0 || pollMs > 1000) {
    throw new Error("invalid shared Git fetch lock wait bounds");
  }
  const common = String(git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
  if (!isAbsolute(common)) throw new Error("shared Git fetch requires an absolute common directory");
  const path = join(realpathSync(common), "dpf-git-fetch.lock");
  const deadline = performance.now() + timeoutMs;
  let lock;
  for (;;) {
    lock = acquireLocalConvergenceLock({ path, reconcileStale: false });
    if (lock.status === "acquired") break;
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      const error = new Error("timed out waiting for shared Git fetch owner; retained existing lock");
      error.code = "GIT_FETCH_LOCK_TIMEOUT";
      throw error;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(pollMs, remaining));
  }
  let operationFailed = false;
  try {
    return operation();
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    // Cleanup uncertainty cannot convert a failed fetch into success, or hide
    // its original error. Only this invocation's token can release the lock.
    try {
      const released = releaseLocalConvergenceLock({ path, token: lock.owner.token });
      if (released.status !== "released") throw new Error("shared Git fetch ownership changed before release");
    } catch (error) {
      if (!operationFailed) throw error;
    }
  }
}

/**
 * @param {(args: string[]) => string} git
 * @returns {boolean} whether origin/main and HEAD share an ancestor locally
 */
export function hasMergeBaseWithOriginMain(git) {
  try {
    return String(git(["merge-base", "origin/main", "HEAD"]) ?? "").trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Fetch origin/main without writing .git/shallow into a full clone.
 *
 * @param {(args: string[]) => string} git
 * @param {{ allowDepthIfAlreadyShallow?: boolean }} [opts]
 */
export function fetchOriginMainSharedSafe(git, opts = {}) {
  return withSharedGitFetchLock(git, () => fetchOriginMainLocked(git, opts), opts);
}

function fetchOriginMainLocked(git, opts) {
  const allowDepthIfAlreadyShallow = opts.allowDepthIfAlreadyShallow !== false;
  const shallow = isShallowRepository(git);
  if (shallow && allowDepthIfAlreadyShallow) {
    // Already shallow (typical CI): refresh the tip with depth rather than
    // pulling all of main's history.
    git(["fetch", "--no-tags", "--depth=1", "origin", "main"]);
    // A depth-1 refresh CAN make it worse: once main has moved past the
    // branch's base, the new shallow boundary at main's tip cuts the shared
    // ancestor, and every `origin/main...HEAD` guard then reports "no merge
    // base" and does not run. Observed in cloud agent sessions (shallow
    // clones). A CI merge ref has main's tip as a parent, so it finds the
    // merge base at once; a branch cut from an older main deepens in steps
    // until the shared ancestor is back, bounded so a truly unrelated HEAD
    // cannot fetch forever.
    for (let step = 0; step < SHALLOW_DEEPEN_MAX_STEPS; step++) {
      if (hasMergeBaseWithOriginMain(git)) {
        return { mode: "depth-on-already-shallow", deepenedBy: step * SHALLOW_DEEPEN_STEP };
      }
      git(["fetch", "--no-tags", `--deepen=${SHALLOW_DEEPEN_STEP}`, "origin", "main"]);
    }
    return {
      mode: "depth-on-already-shallow",
      deepenedBy: SHALLOW_DEEPEN_MAX_STEPS * SHALLOW_DEEPEN_STEP,
      mergeBase: hasMergeBaseWithOriginMain(git),
    };
  }
  // Full clone / linked worktree: NEVER pass --depth.
  git(["fetch", "--no-tags", "origin", "main"]);
  return { mode: "full-fetch" };
}

/**
 * Fail if this object store is shallow — used by verify-preflight / local
 * invariants so a poisoned root clone fails loud.
 *
 * @param {(args: string[]) => string} git
 * @param {{ label?: string }} [opts]
 */
export function assertRepoNotShallow(git, opts = {}) {
  const label = opts.label ?? "repository";
  if (isShallowRepository(git)) {
    const err = new Error(
      `[BI-1ADD56FC] ${label} is a shallow Git repository (.git/shallow present). ` +
        "A depth-limited fetch poisoned the shared object store and breaks merge-base " +
        "for linked worktrees. Repair with: git fetch --unshallow origin  (or " +
        "git fetch --unshallow origin main). Do not run `git fetch --depth=…` against " +
        "the shared root clone or any linked worktree.",
    );
    err.code = "REPO_IS_SHALLOW";
    throw err;
  }
}

/**
 * Deepen a shallow repo in place (BI-AA2201B0). A `git merge` against a
 * candidate ref that landed via a disjoint shallow graft (e.g. a separate
 * depth-limited fetch of just that ref) fails with "refusing to merge
 * unrelated histories" even when the two refs share real ancestry on the
 * remote — the local object store just can't see it. `--unshallow` is the
 * same repair `assertRepoNotShallow` already documents; this wraps it so
 * mutating callers (a merge that MUST succeed, not just a read-only diff)
 * can self-repair instead of failing loud. No-op when already full, so it is
 * safe to call unconditionally before every merge — only fetches once, the
 * first time the shallow boundary is still present.
 *
 * @param {(args: string[]) => string} git
 * @param {{ remote?: string }} [opts]
 */
export function unshallowRootSharedSafe(git, opts = {}) {
  return withSharedGitFetchLock(git, () => {
    if (!isShallowRepository(git)) return { mode: "already-full" };
    git(["fetch", "--unshallow", opts.remote ?? "origin"]);
    return { mode: "unshallowed" };
  }, opts);
}

/** Default git runner for CLI use. */
export function defaultGit(args) {
  return gitText(args, { cwd: process.cwd(), trim: false });
}

// CLI: node scripts/lib/git-fetch-shared-safe.mjs assert|fetch
if (isEntryModule(import.meta.url)) {
  const cmd = process.argv[2] || "assert";
  try {
    if (cmd === "assert") {
      assertRepoNotShallow(defaultGit);
      process.stdout.write("[git-fetch-shared-safe] ok — repository is not shallow\n");
      process.exit(0);
    }
    if (cmd === "fetch") {
      const r = fetchOriginMainSharedSafe(defaultGit);
      process.stdout.write(`[git-fetch-shared-safe] fetch origin main mode=${r.mode}\n`);
      process.exit(0);
    }
    process.stderr.write(`usage: git-fetch-shared-safe.mjs assert|fetch\n`);
    process.exit(2);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
