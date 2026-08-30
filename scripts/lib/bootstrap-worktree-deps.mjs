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

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolveHostCommandInvocation } from "./host-command-invocation.mjs";
import { isEntryModule } from "./entry-module.mjs";
import { parseRepositoryPnpmVersion, resolvePinnedPnpmInvocation } from "./pinned-pnpm.mjs";

export { resolvePinnedPnpmInvocation } from "./pinned-pnpm.mjs";

/**
 * Readiness classification given probe results. Pure — unit-tested.
 * compile-ready ONLY when deps resolved AND a cheap gate passed: structural
 * presence of node_modules is not enough (a partial/stale install is not ready).
 */
export function classifyReadiness({ hasNodeModules, depProbeOk, gateOk }) {
  if (hasNodeModules && depProbeOk && gateOk) return "compile-ready";
  return "source-only";
}

// BI-1C1483C6: the three artifacts whose absence produces failures that look
// exactly like real code breakage. Observed 2026-08-04: `apps/web/node_modules`
// was an EMPTY directory (0 entries) and the worktree root had none at all,
// which surfaced only much later as `'next' is not recognized` from the
// pre-commit typecheck and 14 vitest suites failing with "Cannot find package
// 'react'". Confirming those were environmental cost a `git stash` + re-run per
// suspicion — and an agent that does not think to stash reports them as
// regressions IT caused.
//
// `existsSync` alone is not the test: an EMPTY directory is the observed shape,
// and it passes existsSync. Emptiness is the signal.
export const WORKTREE_COMPILE_ARTIFACTS = Object.freeze([
  Object.freeze({
    path: "node_modules",
    label: "root node_modules",
    forbids: "any pnpm script, typecheck, or vitest run",
  }),
  Object.freeze({
    path: "apps/web/node_modules",
    label: "apps/web/node_modules",
    forbids: "pnpm --filter web typecheck (fails as \"'next' is not recognized\") and component tests",
  }),
  Object.freeze({
    path: "packages/db/generated",
    label: "packages/db/generated (Prisma client)",
    forbids: "any Prisma-touching test (fails as \"Cannot find module '../generated/client/client'\")",
  }),
]);

/**
 * Which of the named compile artifacts are absent or empty. READ-ONLY by
 * construction — this module must never create, junction, or remove anything
 * under node_modules. A worktree's node_modules is normally a JUNCTION to the
 * root clone, and `rm -rf` on it has previously gutted the root clone (1198
 * deleted sources); a bare `pnpm install` writes THROUGH the junction. Probing
 * is safe precisely because it only reads.
 *
 * @param {string} worktreePath
 * @param {{ readdir?: (dir: string) => string[], exists?: (p: string) => boolean }} [deps]
 */
export function missingCompileArtifacts(worktreePath, deps = {}) {
  const exists = deps.exists ?? ((p) => existsSync(p));
  const readdir = deps.readdir ?? ((dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  });
  const wt = norm(worktreePath);
  const missing = [];
  for (const artifact of WORKTREE_COMPILE_ARTIFACTS) {
    const full = `${wt}/${artifact.path}`;
    if (!exists(full)) {
      missing.push({ ...artifact, state: "absent" });
      continue;
    }
    if (readdir(full).length === 0) {
      missing.push({ ...artifact, state: "empty" });
    }
  }
  return missing;
}

/** Operator-readable reason for the readiness outcome (written to the marker). */
export function readinessReason({ hasNodeModules, depProbeOk, gateOk, staleWorkspaceLinks }) {
  if (!hasNodeModules) return "node_modules_missing";
  if (!depProbeOk) return "dependency_resolution_failed";
  if (staleWorkspaceLinks && staleWorkspaceLinks.length > 0) return "workspace_links_stale";
  if (!gateOk) return "cheap_gate_failed";
  return "managed_bootstrap_ok";
}

function executeCommand(cmd, args, cwd, opts = {}) {
  const invocation = resolveHostCommandInvocation(cmd, args, opts);
  try {
    const stdout = execFileSync(invocation.command, invocation.args, {
      cwd,
      stdio: "pipe",
      encoding: "utf8",
    });
    return { ok: true, ...invocation, status: 0, signal: null, stdout, stderr: "" };
  } catch (cause) {
    return {
      ok: false,
      ...invocation,
      status: cause?.status ?? null,
      signal: cause?.signal ?? null,
      error: {
        name: cause?.name ?? "Error",
        code: cause?.code ?? null,
        message: cause?.message ?? String(cause),
      },
      stdout: String(cause?.stdout ?? ""),
      stderr: String(cause?.stderr ?? ""),
    };
  }
}

function run(cmd, args, cwd, opts = {}) {
  return (opts.execute ?? executeCommand)(cmd, args, cwd, opts).ok;
}

export function classifyIgnoredBuilds(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).map((line) => line.trim());
  const header = lines.findIndex((line) => /ignored builds during installation/i.test(line));
  if (header < 0) return { ok: true, packages: [] };
  const packages = lines
    .slice(header + 1)
    .map((line) => line.replace(/^[-*•]\s*/, ""))
    .filter((line) => line.length > 0 && !/^none\.?$/i.test(line));
  return { ok: packages.length === 0, packages };
}

export function dependencyPolicyReviewKey({ baseSha, packageName, version, errorCode }) {
  return `dependency-policy:${baseSha}:${packageName}@${version}:${errorCode}`;
}

function splitPackageVersion(value) {
  const at = value.lastIndexOf("@");
  if (at <= 0) return { packageName: value, version: "unknown" };
  return { packageName: value.slice(0, at), version: value.slice(at + 1) || "unknown" };
}

function readPinnedPnpmVersion(worktreePath) {
  try {
    const manifest = JSON.parse(readFileSync(`${worktreePath}/package.json`, "utf8"));
    return parseRepositoryPnpmVersion(manifest.packageManager);
  } catch {
    return null;
  }
}

function createPinnedPnpmRunner(worktreePath, packageManager, opts = {}) {
  const execute = opts.execute ?? executeCommand;
  const versionProbe = execute(packageManager, ["--version"], worktreePath, opts);
  if (!versionProbe.ok) return { ok: false, failure: versionProbe };
  const currentVersion = String(versionProbe.stdout ?? "").trim();
  const pinnedVersion = opts.pinnedPnpmVersion ?? readPinnedPnpmVersion(worktreePath);
  return {
    ok: true,
    currentVersion,
    pinnedVersion,
    run(args) {
      const invocation = resolvePinnedPnpmInvocation(
        packageManager,
        currentVersion,
        pinnedVersion,
        args,
      );
      return execute(invocation.command, invocation.args, worktreePath, opts);
    },
  };
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
  // BI-1C1483C6: check every named artifact, not just the root. The observed
  // failure had a root node_modules that was ABSENT and an apps/web one that
  // existed but was EMPTY — so both the path set and the emptiness test matter.
  const missing = missingCompileArtifacts(worktreePath, opts.artifactDeps);
  const hasNodeModules = !missing.some((m) => m.path === "node_modules");
  const runner = hasNodeModules ? createPinnedPnpmRunner(worktreePath, pkgMgr, opts) : null;
  const depProbeOk = Boolean(runner?.ok && runner.run(["ls", "--depth", "-1"]).ok);
  const ignoredBuildResult = depProbeOk ? runner.run(["ignored-builds"]) : null;
  const ignoredBuilds = ignoredBuildResult?.ok
    ? classifyIgnoredBuilds(ignoredBuildResult.stdout)
    : { ok: false, packages: [] };
  const gitResult = (opts.execute ?? executeCommand)("git", ["rev-parse", "HEAD"], worktreePath, opts);
  const baseSha = gitResult.ok ? String(gitResult.stdout ?? "").trim() : "unknown-base";
  const dependencyPolicyReviewKeys = ignoredBuilds.packages.map((pkg) =>
    dependencyPolicyReviewKey({
      baseSha,
      ...splitPackageVersion(pkg),
      errorCode: "ignored-build",
    }),
  );
  const linkCheck = depProbeOk
    ? checkWorkspaceLinksResolveLocally(worktreePath, opts.linkCheckDeps)
    : { ok: true, stale: [] };
  const gateOk = depProbeOk && ignoredBuilds.ok && linkCheck.ok && missing.length === 0;
  return {
    status: classifyReadiness({ hasNodeModules, depProbeOk, gateOk }),
    reason: !ignoredBuilds.ok && ignoredBuilds.packages.length > 0
      ? `ignored_builds_unclassified:${ignoredBuilds.packages.join(",")}`
      : missing.length > 0 && hasNodeModules && depProbeOk && linkCheck.ok
      ? `missing_compile_artifacts:${missing.map((m) => m.path).join(",")}`
      : readinessReason({ hasNodeModules, depProbeOk, gateOk, staleWorkspaceLinks: linkCheck.stale }),
    missing,
    checks: {
      hasNodeModules,
      depProbeOk,
      gateOk,
      packageManagerVersion: runner?.pinnedVersion ?? runner?.currentVersion ?? null,
      ignoredBuilds: ignoredBuilds.packages,
      dependencyPolicyReviewKeys,
      staleWorkspaceLinks: linkCheck.stale,
    },
  };
}

// BI-1C1483C6 (2): the exact strings an unprovisioned worktree produces. Every
// one of them reads as a code defect at the point of use, which is why they cost
// a `git stash` + re-run cycle per suspicion — and why an agent that skips the
// stash reports them as regressions its own change caused.
const UNPROVISIONED_SIGNATURES = Object.freeze([
  { pattern: /'next' is not recognized|next: (?:command )?not found/i, artifact: "apps/web/node_modules" },
  { pattern: /Cannot find package '(?:react|react-dom)/i, artifact: "node_modules" },
  { pattern: /Cannot find module '.*generated[/\\]client/i, artifact: "packages/db/generated" },
  { pattern: /Cannot find module '@dpf\//i, artifact: "node_modules" },
  { pattern: /ERR_PNPM_NO_.*|command not found: pnpm/i, artifact: "node_modules" },
]);

/**
 * Decide whether a command's output is the unprovisioned-worktree condition
 * rather than a real defect. Pure — the caller supplies both the text and the
 * readiness it already probed, because the text alone is ambiguous: `Cannot
 * find package 'react'` in a COMPILE-READY tree really is a broken dependency
 * and must keep reading as one.
 *
 * @param {string} outputText
 * @param {{ status: string, missing?: Array<{path: string}> }} readiness
 * @returns {{ unprovisioned: boolean, matched: string[], explanation: string }}
 */
export function diagnoseUnprovisionedFailure(outputText, readiness) {
  const text = String(outputText ?? "");
  const matched = UNPROVISIONED_SIGNATURES
    .filter((sig) => sig.pattern.test(text))
    .map((sig) => sig.artifact);
  if (matched.length === 0 || readiness?.status === "compile-ready") {
    return { unprovisioned: false, matched: [], explanation: "" };
  }
  const missingPaths = new Set((readiness?.missing ?? []).map((m) => m.path));
  // Require the signature to CORROBORATE what was actually probed. Otherwise a
  // genuinely broken dependency in a tree that merely lacks the Prisma client
  // would be waved through as "environmental".
  const corroborated = matched.filter((artifact) => missingPaths.has(artifact));
  if (corroborated.length === 0) return { unprovisioned: false, matched, explanation: "" };
  return {
    unprovisioned: true,
    matched: corroborated,
    explanation:
      "This is an UNPROVISIONED WORKTREE, not a code defect: "
      + `${corroborated.join(", ")} ${corroborated.length === 1 ? "is" : "are"} missing or empty in this worktree. `
      + "Do not attribute it to your change and do not stash to check. "
      + "Provision with: node scripts/lib/bootstrap-worktree-deps.mjs . "
      + "(never a bare `pnpm install` in a worktree — it writes THROUGH the junction into the root clone).",
  };
}

/**
 * The banner an agent needs BEFORE it promises a typecheck it cannot run.
 *
 * Naming what is missing is only half of it; naming what that FORBIDS is the
 * half that changes behaviour. An agent that knows it is source-only does not
 * report `Cannot find package 'react'` as a regression it caused.
 *
 * @param {{ status: string, reason: string, missing?: Array<{label: string, state: string, forbids: string}> }} readiness
 * @param {string} worktreePath
 * @returns {string[]} empty when the worktree is compile-ready (say nothing)
 */
export function formatReadinessBanner(readiness, worktreePath) {
  if (readiness.status === "compile-ready") return [];
  const lines = [
    `Worktree verification-readiness: SOURCE-ONLY (${readiness.reason})`,
    `  ${worktreePath}`,
  ];
  for (const item of readiness.missing ?? []) {
    lines.push(`  missing  ${item.label} (${item.state}) — cannot run: ${item.forbids}`);
  }
  lines.push(
    "  Do NOT report failures from those commands as code defects, and do not claim a gate you cannot run.",
    "  Compile-ready costs one managed install: node scripts/lib/bootstrap-worktree-deps.mjs .",
    "  (Never `pnpm install` bare in a worktree and never `rm -rf` node_modules — it is a junction to the root clone.)",
  );
  return lines;
}

/**
 * Run a managed dependency bootstrap in `worktreePath` and return its readiness.
 * - Never mutates the root clone; never junctions; uses pnpm's shared content
 *   store with --prefer-offline so installs are fast and disk-light.
 * - Idempotent: skips the install when the worktree is ALREADY compile-ready.
 *   NOT when node_modules merely exists (BI-705AE7E3) — see below.
 * - Fail-safe: any failure -> source-only; never throws.
 */
export function bootstrapWorktreeDeps(worktreePath, opts = {}) {
  const pkgMgr = opts.packageManager ?? "pnpm";
  const execute = opts.execute ?? executeCommand;
  try {
    // Gate the install on MEASURED READINESS, not on the bare existence of
    // node_modules (BI-705AE7E3). This function's own header says presence is
    // not enough — "a partial/stale install is not ready" — but the guard used
    // to be `!exists(node_modules)`, so a worktree seeded with a partial tree
    // skipped the install FOREVER. Re-running the documented remedy was a no-op
    // and there was no way to force it.
    //
    // That is not a cosmetic bug: pregate refuses to claim a lease for a
    // source-only worktree, so a tree stuck this way could never run the
    // mandatory build gate at all, and every push from it needed a recorded
    // override. Observed 2026-08-26 on a freshly created worktree: 71 entries
    // under node_modules, no .pnpm, no .bin, permanently source-only, while a
    // healthy sibling had 1133 entries and reported compile-ready.
    const before = probeWorktreeReadiness(worktreePath, opts);
    if (opts.force || before.status !== "compile-ready") {
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
      const runner = createPinnedPnpmRunner(worktreePath, pkgMgr, { ...opts, execute });
      if (!runner.ok) {
        const { ok: _ok, ...failure } = runner.failure;
        return { status: "source-only", reason: "package_manager_probe_failed", failure: { phase: "version", ...failure } };
      }
      const install = runner.run(["install", "--prefer-offline", "--frozen-lockfile"]);
      if (!install.ok) {
        const { ok: _ok, ...failure } = install;
        return { status: "source-only", reason: "managed_install_failed", failure: { phase: "install", ...failure } };
      }
    }
    return probeWorktreeReadiness(worktreePath, opts);
  } catch {
    return { status: "source-only", reason: "bootstrap_threw" };
  }
}

// CLI entry: `node scripts/lib/bootstrap-worktree-deps.mjs <worktreePath> [--classify-only]`.
// Default mode is invoked by seed-worktree-mcp when DPF_WORKTREE_BOOTSTRAP=1
// (opt-in; installs). --force reinstalls even when already compile-ready.
// --classify-only never installs — it is cheap enough that
// seed/sync scripts run it unconditionally to replace their old structural-only
// readiness guess with a real dependency-resolution + workspace-link probe.
// Prints the readiness JSON and ALWAYS exits 0 — a bootstrap failure must never
// break the seed script (the worktree just stays source-only). Skipped on import
// so unit tests of the pure helpers never trigger an install (mirrors
// worktree-create.mjs).
if (isEntryModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const classifyOnly = args.includes("--classify-only");
  const target = args.find((a) => !a.startsWith("--")) ?? process.cwd();

  // BI-1C1483C6 (2): make the failure legible AT THE POINT OF USE. Callers that
  // already captured a failing command's output pipe it in on stdin; if the
  // output is the unprovisioned-worktree signature AND the probe corroborates
  // it, print the relabelling. Silent (and exit 0) otherwise, so this can be
  // dropped into any failure path without changing its behaviour.
  if (args.includes("--diagnose-failure")) {
    let text = "";
    try {
      text = readFileSync(0, "utf8");
    } catch {
      process.exit(0);
    }
    const diagnosis = diagnoseUnprovisionedFailure(text, probeWorktreeReadiness(target));
    if (diagnosis.unprovisioned) process.stdout.write(`${diagnosis.explanation}\n`);
    process.exit(0);
  }

  // --force reinstalls even when the probe already says compile-ready
  // (BI-705AE7E3): readiness is measured, but an operator may still want to
  // rebuild a tree they suspect.
  const force = args.includes("--force");
  const result = classifyOnly ? probeWorktreeReadiness(target) : bootstrapWorktreeDeps(target, { force });
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}
