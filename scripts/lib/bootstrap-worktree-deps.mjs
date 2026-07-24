#!/usr/bin/env node
// scripts/lib/bootstrap-worktree-deps.mjs
//
// BI-3047C122 / EP-WORKTREE-HYGIENE — managed dependency bootstrap for a worktree.
//
// A fresh worktree is born SOURCE-ONLY: nothing installs node_modules, so it
// cannot run vitest/tsc and contributors fall back to the fragile "junction a
// sibling's node_modules" dance — which follows a link into the root clone and
// was the mechanism of the 2026-06-19 730-file wipe. principle_decide chose a
// MANAGED dependency bootstrap (pinned pnpm via the shared content store) over a
// root junction: lower blast radius, no root-clone coupling, lockfile-honest.
//
// This helper is IDEMPOTENT and FAIL-SAFE: it never mutates the root clone, never
// junctions, and on any failure leaves the worktree SOURCE-ONLY rather than
// breaking it. It is intentionally NOT auto-run inside the blocking WorktreeCreate
// hook (a multi-minute install must never gate worktree creation) — it is invoked
// explicitly (a `dpf worktree --bootstrap` CLI / the seed script / an opt-in env),
// so worktree creation stays fast and convergence is a deliberate step.

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Readiness classification given probe results. Pure — unit-tested.
 * compile-ready ONLY when deps resolved AND a cheap gate passed: structural
 * presence of node_modules is not enough (a partial/stale install is not ready).
 */
export function classifyReadiness({ hasNodeModules, depProbeOk, gateOk }) {
  if (hasNodeModules && depProbeOk && gateOk) return "compile-ready";
  return "source-only";
}

/** Operator-readable reason for the readiness outcome (written to the marker). */
export function readinessReason({ hasNodeModules, depProbeOk, gateOk }) {
  if (!hasNodeModules) return "node_modules_missing";
  if (!depProbeOk) return "dependency_resolution_failed";
  if (!gateOk) return "cheap_gate_failed";
  return "managed_bootstrap_ok";
}

function run(cmd, args, cwd) {
  try {
    execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a managed dependency bootstrap in `worktreePath` and return its readiness.
 * - Never mutates the root clone; never junctions; uses pnpm's shared content
 *   store with --prefer-offline so installs are fast and disk-light.
 * - Idempotent: if node_modules already resolves, skips the install.
 * - Fail-safe: any failure -> source-only; never throws.
 */
export function bootstrapWorktreeDeps(worktreePath, opts = {}) {
  const pkgMgr = opts.packageManager ?? "pnpm";
  try {
    if (!existsSync(`${worktreePath}/node_modules`)) {
      // Managed install via the shared store; --frozen-lockfile keeps it honest
      // to the worktree's lockfile (a worktree off main carries main's lockfile).
      //
      // This path used to pass --config.minimumReleaseAge=0 to dodge the pnpm
      // release-age floor (BI-C98D003B). That override was removed as dead and
      // misleading (BI-B175621A): --frozen-lockfile skips resolution entirely
      // ("Lockfile is up to date, resolution step is skipped"), and the floor is
      // only consulted while resolving, so it can never fire here. When the
      // lockfile does NOT match the manifest, pnpm fails with
      // ERR_PNPM_OUTDATED_LOCKFILE — still never a release-age error. Keeping the
      // override would have silently defeated a real control on this path once
      // the floor became versioned repo config.
      run(
        pkgMgr,
        ["install", "--prefer-offline", "--frozen-lockfile"],
        worktreePath,
      );
    }
    const hasNodeModules = existsSync(`${worktreePath}/node_modules`);
    const depProbeOk = hasNodeModules && run(pkgMgr, ["ls", "--depth", "-1"], worktreePath);
    // The cheap gate (e.g. one vitest file) is wired in the follow-up slice; for
    // now a resolvable dependency tree is the gate.
    const gateOk = depProbeOk;
    return {
      status: classifyReadiness({ hasNodeModules, depProbeOk, gateOk }),
      reason: readinessReason({ hasNodeModules, depProbeOk, gateOk }),
    };
  } catch {
    return { status: "source-only", reason: "bootstrap_threw" };
  }
}

// CLI entry: `node scripts/lib/bootstrap-worktree-deps.mjs <worktreePath>`.
// Invoked by seed-worktree-mcp when DPF_WORKTREE_BOOTSTRAP=1 (opt-in). Prints the
// readiness JSON and ALWAYS exits 0 — a bootstrap failure must never break the
// seed script (the worktree just stays source-only). Skipped on import so unit
// tests of the pure helpers never trigger an install (mirrors worktree-create.mjs).
const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("bootstrap-worktree-deps.mjs");
if (invokedDirectly) {
  const target = process.argv[2] ?? process.cwd();
  process.stdout.write(JSON.stringify(bootstrapWorktreeDeps(target)) + "\n");
  process.exit(0);
}
