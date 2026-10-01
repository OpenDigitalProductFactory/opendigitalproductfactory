// scripts/lib/root-clone-refresh.mjs
//
// Keep the root clone fast-forwarded to origin/main (EP-PROCESS-SPINE,
// plan 2026-08-11-worktree-lifecycle-hygiene).
//
// stale-root-clone.mjs (BI-A900EA3F) DETECTS a root clone behind origin/main and
// tells the operator to run `git merge --ff-only origin/main`. This is the REMEDY:
// because every peer worktree junctions @dpf/* workspace packages into the root
// tree, a stale root makes `pregate-preflight` abort for EVERY worktree until the
// root is fast-forwarded. Keeping the root current is therefore fleet hygiene, not
// a per-worktree concern.
//
// SAFETY: fast-forward ONLY. Refuse when the root is not on main or is detached —
// the "root stranded on a feature branch" states a forced move would corrupt (the
// exact thing root-clone-guard.mjs blocks for the agent). A ff-only merge can never
// discard commits; it only advances a strictly behind main to its fetched upstream.
//
// Uncommitted files (BI-F676CC23): refuse only when one of them is a path the
// incoming commits change. A dirty file nothing upstream touches is carried
// across the fast-forward untouched — `git merge --ff-only` does exactly that, and
// itself refuses rather than overwrite local changes. Refusing on ANY dirt froze
// the root 90 commits behind for days over one bootstrap-written .mcp.json, so
// every hook wired from the root kept running old code.

import { spawnSync } from "node:child_process";

import { gitText, measureRootBehindOriginMain } from "./stale-root-clone.mjs";

/**
 * Dirty paths that the incoming commits also change. Paths are repo-relative;
 * a path that is a directory prefix of the other counts as overlapping.
 * @param {string[]} dirtyPaths
 * @param {string[]} incomingPaths
 * @returns {string[]}
 */
export function overlappingPaths(dirtyPaths, incomingPaths) {
  const incoming = new Set(incomingPaths);
  const under = (child, parent) => child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
  return dirtyPaths.filter(
    (dirty) => incoming.has(dirty) || incomingPaths.some((inc) => under(inc, dirty) || under(dirty, inc)),
  );
}

/**
 * Pure remediation decision from the root's current state.
 *
 * `overlap` is the list of dirty paths the incoming commits change, or null when
 * it could not be determined. A dirty root fast-forwards only when overlap is
 * known and empty.
 *
 * @param {{ detached: boolean, onMain: boolean, clean: boolean, behind: number, overlap?: string[] | null }} state
 * @returns {{ action: "ff" | "skip" | "refuse", reason: string }}
 */
export function planRootRefresh({ detached, onMain, clean, behind, overlap = null }) {
  if (detached) {
    return { action: "refuse", reason: "root clone is in detached HEAD — not fast-forwarding" };
  }
  if (!onMain) {
    return {
      action: "refuse",
      reason: "root clone is not on main (active work may be stranded there) — not fast-forwarding",
    };
  }
  if (!(behind > 0)) {
    return { action: "skip", reason: "root clone is already at origin/main" };
  }
  if (!clean) {
    if (!Array.isArray(overlap)) {
      return {
        action: "refuse",
        reason: "root clone has uncommitted changes and the incoming change set could not be read — not fast-forwarding",
      };
    }
    if (overlap.length > 0) {
      const shown = overlap.slice(0, 5).join(", ") + (overlap.length > 5 ? `, +${overlap.length - 5} more` : "");
      return {
        action: "refuse",
        reason: `root clone has uncommitted changes to files origin/main also changes (${shown}) — not fast-forwarding`,
      };
    }
    return {
      action: "ff",
      reason: `root clone is ${behind} commit(s) behind origin/main; its uncommitted files are untouched by the incoming commits`,
    };
  }
  return { action: "ff", reason: `root clone is ${behind} commit(s) behind origin/main` };
}

/** NUL-separated git output as a list, or null when git failed. Untrimmed on purpose. */
function readNulList(cwd, args, { spawnSyncImpl = spawnSync } = {}) {
  const r = spawnSyncImpl("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || "").split("\0").filter(Boolean);
}

/**
 * Every uncommitted path (tracked or untracked, both sides of a rename), or null
 * when git status failed — which counts as dirty-and-unknown, never clean.
 */
function readDirtyPaths(cwd, opts) {
  const entries = readNulList(cwd, ["status", "--porcelain", "-z", "--untracked-files=all"], opts);
  if (entries === null) return null;
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const xy = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // -z puts a rename/copy's source path in the following entry.
    if (xy[0] === "R" || xy[0] === "C") paths.push(entries[++i]);
  }
  return paths.filter(Boolean);
}

/**
 * Read the root clone's current state relative to origin/main. Injectable spawn.
 * @param {string} rootClonePath
 * @param {{ spawnSyncImpl?: typeof spawnSync }} [opts]
 */
export function gatherRootState(rootClonePath, { spawnSyncImpl = spawnSync } = {}) {
  const branch = gitText(rootClonePath, ["rev-parse", "--abbrev-ref", "HEAD"], { spawnSyncImpl });
  const detached = branch === "" || branch === "HEAD";
  const onMain = branch === "main";
  const dirtyPaths = readDirtyPaths(rootClonePath, { spawnSyncImpl });
  const clean = dirtyPaths !== null && dirtyPaths.length === 0;
  const measure = measureRootBehindOriginMain(rootClonePath, { spawnSyncImpl });
  let overlap = null;
  if (dirtyPaths && dirtyPaths.length > 0 && measure?.rootSha && measure?.originMainSha) {
    const incoming = readNulList(
      rootClonePath,
      ["diff", "--name-only", "--no-renames", "-z", measure.rootSha, measure.originMainSha],
      { spawnSyncImpl },
    );
    overlap = incoming === null ? null : overlappingPaths(dirtyPaths, incoming);
  }
  return {
    branch,
    detached,
    onMain,
    clean,
    dirtyPaths: dirtyPaths ?? [],
    overlap,
    behind: measure?.behind ?? 0,
    rootSha: measure?.rootSha ?? "",
    originMainSha: measure?.originMainSha ?? "",
  };
}

/**
 * Fetch origin/main (best-effort), then fast-forward the root clone when safe.
 * Never throws; returns a structured result.
 * @param {{
 *   rootClonePath: string,
 *   spawnSyncImpl?: typeof spawnSync,
 *   doFetch?: boolean,
 * }} input
 * @returns {{
 *   action: "ff" | "skip" | "refuse" | "failed",
 *   reason: string,
 *   changed: boolean,
 *   branch: string,
 *   behind: number,
 *   rootSha: string,
 *   originMainSha: string,
 * }}
 */
export function refreshRootClone({ rootClonePath, spawnSyncImpl = spawnSync, doFetch = true }) {
  if (doFetch) {
    // Best-effort; offline just leaves us measuring against the last-known origin/main.
    spawnSyncImpl("git", ["-C", rootClonePath, "fetch", "origin", "main", "--quiet"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
  }

  const state = gatherRootState(rootClonePath, { spawnSyncImpl });
  const plan = planRootRefresh(state);

  if (plan.action !== "ff") {
    return { ...plan, changed: false, ...state };
  }

  const res = spawnSyncImpl("git", ["-C", rootClonePath, "merge", "--ff-only", "origin/main"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  const ok = !res.error && res.status === 0;
  if (ok) {
    return {
      action: "ff",
      reason: `fast-forwarded root clone ${state.behind} commit(s) to origin/main`,
      changed: true,
      ...state,
    };
  }
  return {
    action: "failed",
    reason: `ff-only merge failed: ${(res.stderr || res.error?.message || "").toString().trim().slice(0, 300)}`,
    changed: false,
    ...state,
  };
}
