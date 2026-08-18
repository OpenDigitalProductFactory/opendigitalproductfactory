// scripts/lib/junction-safe-worktree-remove.mjs
//
// Junction-safe `git worktree remove` (BI-F6AC1A56).
//
// PROVEN on this Windows host (2026-06-22): `git worktree remove --force` on a
// worktree whose node_modules is a JUNCTION follows the junction and deletes its
// TARGET's contents. Worktrees nested in the root clone share root node_modules
// via junctions (the DPF junction test workflow), so force-removing one wipes
// the shared root — the 2026-06-19 corruption mechanism (BI-3FAA13A7). The merged
// root-clone delete-guard does NOT cover this: git deletes internally, so no Bash
// `rm`/`Remove-Item` is ever observed by the PreToolUse hook.
//
// Verified-safe primitive (same host): Node `fs.rmdirSync` (win32) / `fs.unlinkSync`
// (posix) on a reparse point UNLINKS it without following it (target survives).
// So: unlink the node_modules junctions/symlinks FIRST, THEN `git worktree remove`
// — which now has nothing to follow.
//
// USAGE (from worktree-janitor.sh / scripts):
//   node scripts/lib/junction-safe-worktree-remove.mjs <root> <worktreePath> [--force]
// Exits 0 on successful removal, non-zero otherwise. Prints a one-line summary.

import { lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { isEntryModule } from "./entry-module.mjs";

// node_modules is THE reparse-point vector in DPF worktrees: <wt>/node_modules
// and the workspace packages' <wt>/{apps,packages,services}/*/node_modules.
const NODE_MODULES = "node_modules";
const WORKSPACE_CONTAINERS = ["apps", "packages", "services"];

function norm(p) {
  return String(p ?? "").replace(/\\/g, "/").replace(/\/+$/g, "");
}

/**
 * Candidate node_modules paths to inspect inside a worktree — the top-level one
 * plus each workspace package's. Pure; readdir is injectable for tests.
 */
export function candidateNodeModulesPaths(worktreePath, readdir = safeReaddirDirs) {
  const wt = norm(worktreePath);
  const out = [`${wt}/${NODE_MODULES}`];
  for (const container of WORKSPACE_CONTAINERS) {
    for (const pkg of readdir(`${wt}/${container}`)) {
      out.push(`${wt}/${container}/${pkg}/${NODE_MODULES}`);
    }
  }
  return out;
}

/** Reparse points (junctions/symlinks) among the candidate node_modules paths. */
export function findReparsePoints(worktreePath, deps = {}) {
  const readdir = deps.readdir ?? safeReaddirDirs;
  const isReparse = deps.isReparse ?? defaultIsReparse;
  return candidateNodeModulesPaths(worktreePath, readdir).filter(isReparse);
}

/**
 * Unlink a reparse point WITHOUT following it. win32 junctions are removed with
 * rmdir (the reparse point is an empty-from-the-FS-view dir); posix symlinks with
 * unlink. Both verified non-following on this host.
 */
export function unlinkReparsePoint(p, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const rmdir = deps.rmdir ?? rmdirSync;
  const unlink = deps.unlink ?? unlinkSync;
  if (platform === "win32") {
    try {
      rmdir(p);
    } catch {
      unlink(p); // a true symlink (not a junction) on win32 — unlink removes it
    }
  } else {
    unlink(p);
  }
}

/**
 * Junction-safe removal: unlink node_modules reparse points, then
 * `git worktree remove` (with --force when requested — now safe because there is
 * no junction left for git to follow). Returns a structured result; never throws.
 */
export function safeRemoveWorktree({ root, worktreePath, force = false, deps = {} } = {}) {
  const find = deps.findReparsePoints ?? findReparsePoints;
  const unlink = deps.unlinkReparsePoint ?? unlinkReparsePoint;
  const git = deps.git ?? defaultGit;

  const reparse = find(worktreePath);
  const unlinked = [];
  const failedUnlink = [];
  for (const p of reparse) {
    try {
      unlink(p);
      unlinked.push(p);
    } catch (err) {
      // A reparse point we could not unlink would still be followed by git's
      // --force removal — so REFUSE to force-remove and surface it instead.
      failedUnlink.push({ path: p, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (failedUnlink.length > 0) {
    return {
      removed: false,
      unlinked,
      failedUnlink,
      detail: `refusing to remove: could not unlink reparse point(s) that git --force would follow: ${failedUnlink
        .map((f) => f.path)
        .join(", ")}`,
    };
  }

  const args = ["-C", root, "worktree", "remove", worktreePath, ...(force ? ["--force"] : [])];
  const res = git(args);
  return {
    removed: res.ok,
    unlinked,
    failedUnlink,
    detail: res.detail,
  };
}

// ── default side-effecting impls (isolated from the pure exports above) ───────

function defaultIsReparse(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function safeReaddirDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function defaultGit(args) {
  const res = spawnSync("git", args, { encoding: "utf8" });
  const ok = !res.error && res.status === 0;
  const detail = (ok ? res.stdout : res.stderr || res.error?.message || "").trim();
  return { ok, detail };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main(argv) {
  const args = argv.filter((a) => a !== "--force");
  const force = argv.includes("--force");
  const [root, worktreePath] = args;
  if (!root || !worktreePath) {
    console.error("usage: node scripts/lib/junction-safe-worktree-remove.mjs <root> <worktreePath> [--force]");
    process.exit(64);
  }
  const result = safeRemoveWorktree({ root, worktreePath, force });
  if (result.unlinked.length > 0) {
    console.log(`[junction-safe-remove] unlinked ${result.unlinked.length} reparse point(s): ${result.unlinked.join(", ")}`);
  }
  console.log(`[junction-safe-remove] ${result.removed ? "removed" : "did NOT remove"} ${worktreePath}${result.detail ? ` — ${result.detail}` : ""}`);
  process.exit(result.removed ? 0 : 1);
}

// Run only when invoked directly (not when imported by a test).
if (isEntryModule(import.meta.url)) {
  main(process.argv.slice(2));
}
