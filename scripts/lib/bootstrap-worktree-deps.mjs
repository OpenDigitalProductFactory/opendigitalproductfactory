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

import { existsSync, readdirSync, realpathSync } from "node:fs";
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
export function readinessReason({ hasNodeModules, depProbeOk, gateOk, staleWorkspaceLinks }) {
  if (!hasNodeModules) return "node_modules_missing";
  if (!depProbeOk) return "dependency_resolution_failed";
  if (staleWorkspaceLinks && staleWorkspaceLinks.length > 0) return "workspace_links_stale";
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

function norm(p) {
  return String(p ?? "").replace(/\\/g, "/").replace(/\/+$/g, "");
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

function defaultRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Detects the 2026-07-24 stale-junction incident class (BI-3047C122 follow-up):
 * node_modules/@dpf/<pkg> resolving OUTSIDE this worktree — a sibling worktree's
 * packages/<pkg> — instead of this worktree's own workspace source. A fresh
 * worktree that auto-junctioned a "compatible" sibling's node_modules typechecks
 * clean against the WRONG source silently; structural presence of node_modules
 * is not proof the tree is actually THIS worktree's. Pure aside from injected fs
 * deps — unit-tested without touching the real filesystem.
 */
export function checkWorkspaceLinksResolveLocally(worktreePath, deps = {}) {
  const readdir = deps.readdir ?? safeReaddirDirs;
  const realpath = deps.realpath ?? defaultRealpath;
  const wt = norm(worktreePath);
  const names = readdir(`${wt}/node_modules/@dpf`);
  const stale = [];
  for (const name of names) {
    const real = realpath(`${wt}/node_modules/@dpf/${name}`);
    if (real === null) continue; // broken link is a dep-resolution failure, not a staleness finding
    const realNorm = norm(real);
    if (realNorm !== wt && !realNorm.startsWith(`${wt}/`)) {
      stale.push({ name, target: realNorm });
    }
  }
  return { ok: stale.length === 0, stale };
}

/**
 * Classify a worktree's compile readiness WITHOUT installing anything — cheap
 * enough to run unconditionally (unlike bootstrapWorktreeDeps' install path,
 * which is opt-in because a multi-minute install must not gate every call).
 * The cheap gate is dependency resolution (`pnpm ls`) AND every @dpf/* workspace
 * link resolving inside this worktree — the two things structural node_modules
 * presence does NOT prove.
 */
export function probeWorktreeReadiness(worktreePath, opts = {}) {
  const pkgMgr = opts.packageManager ?? "pnpm";
  const hasNodeModules = existsSync(`${worktreePath}/node_modules`);
  const depProbeOk = hasNodeModules && run(pkgMgr, ["ls", "--depth", "-1"], worktreePath);
  const linkCheck = depProbeOk
    ? checkWorkspaceLinksResolveLocally(worktreePath, opts.linkCheckDeps)
    : { ok: true, stale: [] };
  const gateOk = depProbeOk && linkCheck.ok;
  return {
    status: classifyReadiness({ hasNodeModules, depProbeOk, gateOk }),
    reason: readinessReason({ hasNodeModules, depProbeOk, gateOk, staleWorkspaceLinks: linkCheck.stale }),
    checks: { hasNodeModules, depProbeOk, gateOk, staleWorkspaceLinks: linkCheck.stale },
  };
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
    return probeWorktreeReadiness(worktreePath, opts);
  } catch {
    return { status: "source-only", reason: "bootstrap_threw" };
  }
}

// CLI entry: `node scripts/lib/bootstrap-worktree-deps.mjs <worktreePath> [--classify-only]`.
// Default mode is invoked by seed-worktree-mcp when DPF_WORKTREE_BOOTSTRAP=1
// (opt-in; installs). --classify-only never installs — it is cheap enough that
// seed/sync scripts run it unconditionally to replace their old structural-only
// readiness guess with a real dependency-resolution + workspace-link probe.
// Prints the readiness JSON and ALWAYS exits 0 — a bootstrap failure must never
// break the seed script (the worktree just stays source-only). Skipped on import
// so unit tests of the pure helpers never trigger an install (mirrors
// worktree-create.mjs).
const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("bootstrap-worktree-deps.mjs");
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const classifyOnly = args.includes("--classify-only");
  const target = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const result = classifyOnly ? probeWorktreeReadiness(target) : bootstrapWorktreeDeps(target);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}
