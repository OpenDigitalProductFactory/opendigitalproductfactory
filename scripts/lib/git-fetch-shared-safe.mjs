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

import { execFileSync } from "node:child_process";

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

/**
 * Fetch origin/main without writing .git/shallow into a full clone.
 *
 * @param {(args: string[]) => string} git
 * @param {{ allowDepthIfAlreadyShallow?: boolean }} [opts]
 */
export function fetchOriginMainSharedSafe(git, opts = {}) {
  const allowDepthIfAlreadyShallow = opts.allowDepthIfAlreadyShallow !== false;
  const shallow = isShallowRepository(git);
  if (shallow && allowDepthIfAlreadyShallow) {
    // Already shallow (typical CI): deepen/refresh with depth is fine — cannot
    // make it worse. Prefer fetching the needed tip without converting others.
    git(["fetch", "--no-tags", "--depth=1", "origin", "main"]);
    return { mode: "depth-on-already-shallow" };
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
  if (!isShallowRepository(git)) return { mode: "already-full" };
  git(["fetch", "--unshallow", opts.remote ?? "origin"]);
  return { mode: "unshallowed" };
}

/** Default git runner for CLI use. */
export function defaultGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
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
