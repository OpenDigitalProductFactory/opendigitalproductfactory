// scripts/lib/stale-root-clone.mjs
//
// BI-A900EA3F — detect a stale root clone that can produce phantom typecheck
// errors in junctioned worktrees. When node_modules junctions resolve @dpf/*
// workspace packages into the root clone source tree, a root checkout that is
// behind origin/main causes errors in files the worktree branch never touched.
//
// Pure helpers + a check entry point. Two `git rev-parse` / rev-list calls only.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ spawnSyncImpl?: typeof spawnSync }} [opts]
 */
export function gitText(cwd, args, { spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

/**
 * Resolve the root clone path that owns this worktree's git common dir.
 * For a normal clone, common-dir is `.git` under the toplevel. For a linked
 * worktree, common-dir points at the main repository `.git`.
 *
 * @param {string} worktreeRoot
 * @param {{ spawnSyncImpl?: typeof spawnSync }} [opts]
 * @returns {string | null}
 */
export function resolveRootClonePath(worktreeRoot, opts = {}) {
  const commonDir = gitText(worktreeRoot, ["rev-parse", "--git-common-dir"], opts);
  if (!commonDir) return null;
  const absoluteCommon = resolve(worktreeRoot, commonDir);
  // common-dir ends in `.git` for a standard main worktree store.
  if (absoluteCommon.endsWith(`${"\\"}git`) || absoluteCommon.endsWith("/.git") || absoluteCommon.endsWith(".git")) {
    return dirname(absoluteCommon);
  }
  return absoluteCommon;
}

/**
 * True when worktree node_modules (or a package under it) is a junction/symlink
 * into the root clone.
 *
 * @param {string} worktreeRoot
 * @param {string} rootClonePath
 */
export function nodeModulesJunctionsToRoot(worktreeRoot, rootClonePath) {
  const nm = join(worktreeRoot, "node_modules");
  if (!existsSync(nm)) return false;
  try {
    const st = lstatSync(nm);
    if (st.isSymbolicLink()) {
      const target = resolve(dirname(nm), readlinkSync(nm));
      const root = resolve(rootClonePath);
      return target === root || target.startsWith(root + "\\") || target.startsWith(root + "/");
    }
  } catch {
    // ignore
  }
  // Workspace packages often junction individually under node_modules/@dpf/*
  const dpfScope = join(nm, "@dpf");
  if (!existsSync(dpfScope)) return false;
  try {
    for (const entry of readdirSync(dpfScope)) {
      const p = join(dpfScope, entry);
      try {
        if (lstatSync(p).isSymbolicLink()) {
          const target = resolve(dirname(p), readlinkSync(p));
          const root = resolve(rootClonePath);
          if (target === root || target.startsWith(root + "\\") || target.startsWith(root + "/")) {
            return true;
          }
          // package path under root packages/
          if (target.includes(`${root}\\packages\\`) || target.includes(`${root}/packages/`)) {
            return true;
          }
        }
      } catch {
        // continue
      }
    }
  } catch {
    // continue
  }
  return false;
}

/**
 * How many commits the root clone's HEAD is behind origin/main.
 *
 * @param {string} rootClonePath
 * @param {{ spawnSyncImpl?: typeof spawnSync }} [opts]
 * @returns {{ behind: number, rootSha: string, originMainSha: string } | null}
 */
export function measureRootBehindOriginMain(rootClonePath, opts = {}) {
  const rootSha = gitText(rootClonePath, ["rev-parse", "HEAD"], opts);
  const originMainSha = gitText(rootClonePath, ["rev-parse", "origin/main"], opts);
  if (!rootSha || !originMainSha) return null;
  if (rootSha === originMainSha) {
    return { behind: 0, rootSha, originMainSha };
  }
  const count = gitText(
    rootClonePath,
    ["rev-list", "--count", `${rootSha}..${originMainSha}`],
    opts,
  );
  const behind = Number(count);
  if (!Number.isFinite(behind)) return null;
  return { behind, rootSha, originMainSha };
}

/**
 * @param {{
 *   worktreeRoot: string,
 *   spawnSyncImpl?: typeof spawnSync,
 *   requireJunction?: boolean,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   skipped?: string,
 *   behind?: number,
 *   rootClonePath?: string,
 *   message?: string,
 *   cause?: "stale-root-clone" | "base-drift-hint",
 * }}
 */
export function checkStaleRootClone({
  worktreeRoot,
  spawnSyncImpl = spawnSync,
  requireJunction = true,
}) {
  const rootClonePath = resolveRootClonePath(worktreeRoot, { spawnSyncImpl });
  if (!rootClonePath) {
    return { ok: true, skipped: "could-not-resolve-root-clone" };
  }

  // Same checkout as the worktree root — not a linked worktree.
  if (resolve(rootClonePath) === resolve(worktreeRoot)) {
    return { ok: true, skipped: "not-a-linked-worktree" };
  }

  if (requireJunction && !nodeModulesJunctionsToRoot(worktreeRoot, rootClonePath)) {
    return { ok: true, skipped: "no-root-junctioned-node-modules", rootClonePath };
  }

  const measure = measureRootBehindOriginMain(rootClonePath, { spawnSyncImpl });
  if (!measure) {
    return { ok: true, skipped: "could-not-measure-behind", rootClonePath };
  }

  if (measure.behind <= 0) {
    return { ok: true, behind: 0, rootClonePath };
  }

  const message = [
    `Stale root clone detected (BI-A900EA3F).`,
    `Root clone at ${rootClonePath} is ${measure.behind} commit(s) behind origin/main.`,
    `Junctioned @dpf/* workspace packages resolve into that root tree, so typecheck can fail`,
    `on files your branch never touched (phantom errors).`,
    ``,
    `Cause: stale-root-clone (NOT base-drift). Rebasing this worktree will NOT fix it.`,
    `Remedy (when root is clean and on main):`,
    `  git -C "${rootClonePath}" merge --ff-only origin/main`,
    ``,
    `If errors instead mention generated artifacts (doc-index, route-manifest), that is`,
    `base-drift — rebase this worktree onto origin/main, then regenerate artifacts.`,
  ].join("\n");

  return {
    ok: false,
    behind: measure.behind,
    rootClonePath,
    message,
    cause: "stale-root-clone",
  };
}
