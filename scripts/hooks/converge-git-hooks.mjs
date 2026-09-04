#!/usr/bin/env node
// scripts/hooks/converge-git-hooks.mjs
//
// SessionStart hook (BI-3727106F): make the local-CI pre-push gate self-healing.
//
// THE DEFECT THIS CLOSES
//   `.githooks/pre-push` is untracked and generated; the enforcing logic is the
//   tracked `.githooks/lib/pre-push-chained.sh`. Convergence between them ran
//   ONLY in `pnpm install` postinstall. So:
//     - a worktree created before a fix, or never reinstalled since, keeps the
//       stock git-lfs shim and pushes with NO gate; and
//     - worse, it runs its OWN copy of the converger, so a tree sitting on a
//       base that predates the fix can never repair itself. The fix only
//       reaches trees that already contain the fix.
//   Measured on this install 2026-08-26: 68 of 85 worktrees were ungated, and
//   a clean push from an ungated tree is byte-identical to a clean push from a
//   gated one. Absence of enforcement looked exactly like satisfied enforcement.
//
// THE SHAPE OF THE FIX
//   Converge at SESSION START, not install time, and sweep SIBLING worktrees
//   from the tree that is running — because the session that just started is,
//   by construction, running current code. A merged fix then reaches every tree
//   by being merged, instead of by every developer remembering to reinstall.
//
// SAFETY
//   - Only ever writes a shim classified `missing` or `lfs-stock`; a
//     hand-rolled hook is reported and left alone (ensure-pre-push-hook.mjs).
//   - Refuses to converge a tree lacking the chained script, which would turn
//     "not gated" into "cannot push" (convergeHooksDir -> `chain-absent`).
//   - Sibling sweep is throttled via a marker in the shared git dir, so N
//     concurrent sessions do one sweep, not N.
//   - NEVER blocks session start: every path exits 0, and the whole body is
//     wrapped. A hook that breaks startup is a worse defect than the one it fixes.
//   - Set DPF_SKIP_HOOK_CONVERGENCE=1 to opt out entirely.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convergeHooksDir, summarizeConvergence } from "../lib/converge-hooks-dir.mjs";

/** One sweep per repo per interval, however many sessions start. */
export const SWEEP_THROTTLE_MS = 30 * 60 * 1000;
const MARKER_NAME = "dpf-hook-sweep.stamp";
const GIT_TIMEOUT_MS = 10_000;

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Extract worktree paths from `git worktree list --porcelain`.
 * @param {string} porcelain
 * @returns {string[]}
 */
export function parseWorktreePaths(porcelain) {
  return String(porcelain ?? "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

/**
 * Has the throttle window elapsed? An unreadable/absent marker means "never
 * swept" — fail toward sweeping, since the cost of an extra sweep is a few
 * file stats and the cost of skipping one is an ungated push.
 * @param {number | null} markerMs epoch ms of the last sweep, or null
 * @param {number} nowMs
 * @param {number} [throttleMs]
 */
export function shouldSweep(markerMs, nowMs, throttleMs = SWEEP_THROTTLE_MS) {
  if (markerMs == null || !Number.isFinite(markerMs)) return true;
  return nowMs - markerMs >= throttleMs;
}

// ── git helpers ──────────────────────────────────────────────────────────────

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readMarkerMs(markerPath) {
  try {
    return fs.statSync(markerPath).mtimeMs;
  } catch {
    return null;
  }
}

function touchMarker(markerPath) {
  try {
    fs.writeFileSync(markerPath, new Date().toISOString(), "utf8");
  } catch {
    /* throttling is best-effort; an unwritable marker just means we sweep again */
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

export function run({ cwd = process.cwd(), now = Date.now(), log = console.log } = {}) {
  if (process.env.DPF_SKIP_HOOK_CONVERGENCE === "1") return { skipped: "opt-out" };

  const topLevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!topLevel) return { skipped: "not-a-git-repo" };

  // core.hooksPath is repo-level config; re-assert it cheaply. Without it git
  // reads .git/hooks and every tracked hook in .githooks is inert.
  git(cwd, ["config", "core.hooksPath", ".githooks"]);

  // 1. Always converge the tree this session is actually working in.
  const own = convergeHooksDir(path.join(topLevel, ".githooks"));
  const results = [own];

  // 2. Sweep siblings, throttled across concurrent sessions.
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const markerPath = commonDir ? path.join(commonDir, MARKER_NAME) : null;
  let swept = false;
  if (markerPath && shouldSweep(readMarkerMs(markerPath), now)) {
    const porcelain = git(cwd, ["worktree", "list", "--porcelain"]);
    if (porcelain) {
      swept = true;
      touchMarker(markerPath);
      for (const tree of parseWorktreePaths(porcelain)) {
        if (path.resolve(tree) === path.resolve(topLevel)) continue;
        results.push(convergeHooksDir(path.join(tree, ".githooks")));
      }
    }
  }

  // 3. Report only when there is something a human should know. A repair, a
  //    refusal or a failure is news; "already converged" is not.
  const newsworthy = results.some(
    (r) => r.prePush === "written" || r.prePush === "chain-absent" || r.prePush === "error" || r.error,
  );
  if (newsworthy) log(`[dpf-hooks] ${summarizeConvergence(results)}`);
  else if (own.prePush === "left-custom") log("[dpf-hooks] custom pre-push hook left untouched; local-CI gate is NOT chained here");

  return { results, swept, reported: newsworthy };
}

// fileURLToPath, never `new URL(...).pathname` — that is BI-5CBDC146 itself:
// on Windows the pathname is "/D:/repo/..." and every path built from it is
// unopenable. Re-deriving it by hand here would rebuild the defect this file exists to fix.
const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    run();
  } catch (err) {
    // Session start must never fail because a convergence hook threw.
    console.warn(`[dpf-hooks] convergence skipped: ${err?.message ?? err}`);
  }
  process.exit(0);
}
