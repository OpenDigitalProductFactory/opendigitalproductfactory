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
// SAFETY: fast-forward ONLY. Refuse when the root is not on main, is detached, or
// is dirty — those are the "root stranded on a feature branch / mid-edit" states a
// forced move would corrupt (the exact thing root-clone-guard.mjs blocks for the
// agent). A ff-only merge can never discard commits; it only advances a strictly
// behind, clean main to its already-fetched upstream.

import { spawnSync } from "node:child_process";

import { gitText, measureRootBehindOriginMain } from "./stale-root-clone.mjs";

/**
 * Pure remediation decision from the root's current state.
 * @param {{ detached: boolean, onMain: boolean, clean: boolean, behind: number }} state
 * @returns {{ action: "ff" | "skip" | "refuse", reason: string }}
 */
export function planRootRefresh({ detached, onMain, clean, behind }) {
  if (detached) {
    return { action: "refuse", reason: "root clone is in detached HEAD — not fast-forwarding" };
  }
  if (!onMain) {
    return {
      action: "refuse",
      reason: "root clone is not on main (active work may be stranded there) — not fast-forwarding",
    };
  }
  if (!clean) {
    return {
      action: "refuse",
      reason: "root clone has uncommitted changes — not fast-forwarding",
    };
  }
  if (!(behind > 0)) {
    return { action: "skip", reason: "root clone is already at origin/main" };
  }
  return { action: "ff", reason: `root clone is ${behind} commit(s) behind origin/main` };
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
  const clean = gitText(rootClonePath, ["status", "--porcelain"], { spawnSyncImpl }) === "";
  const measure = measureRootBehindOriginMain(rootClonePath, { spawnSyncImpl });
  return {
    branch,
    detached,
    onMain,
    clean,
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
