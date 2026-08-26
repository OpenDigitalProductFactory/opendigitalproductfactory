// scripts/lib/ensure-compile-ready.mjs — Stage 0 of the Resilient Concurrent
// Development Process (DOC-C263E0C9, BI-6C54223E): turn the advisory SOURCE-ONLY
// worktree banner into an enforced, intent-aware, lazy readiness gate.
//
// Before Stage 0, a source-only worktree passed the pregate with a WARN (the
// agent may ignore it, then attribute the resulting `Cannot find package
// 'react'` failures to its own change). This gate makes compile-readiness
// non-optional for code/test work WITHOUT paying a blanket install cost:
//
//   - compile-ready              -> ok (the cheap steady state; no install)
//   - source-only + DOCS intent  -> ok (source-only is legitimate for docs)
//   - source-only + CODE intent  -> auto-heal via the managed bootstrap;
//                                   re-probe; block with the exact missing
//                                   items only if the heal fails.
//
// Intent is derived from the changed files so the cost is lazy: a docs thread
// never triggers an install, and only the pushing code thread pays, once, for
// its own worktree — respecting the low-RAM constraint (BI-8D56F777 C2).

import { execFileSync } from "node:child_process";
import {
  probeWorktreeReadiness,
  bootstrapWorktreeDeps,
  formatReadinessBanner,
} from "./bootstrap-worktree-deps.mjs";

/**
 * All files this branch changed vs its merge-base with origin/main, INCLUDING
 * uncommitted working-tree changes (diffing the working tree against the base).
 * Fail-safe: returns null on any git error so the caller enforces as code
 * intent rather than waving a change through on a missing base ref.
 */
export function getChangedFilesAgainstMain(worktreePath, run = execFileSync) {
  try {
    const git = (args) =>
      String(run("git", args, { cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) ?? "");
    const base = git(["merge-base", "HEAD", "origin/main"]).trim();
    if (!base) return null;
    return git(["diff", "--name-only", base])
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * A changed path that needs no compiled runtime to verify (prose only).
 * Extension-based on purpose: a code file (`.ts`, `.mjs`, `.json`) under docs/
 * still needs a compile-ready tree, so directory is NOT a safe signal — only the
 * extension is. Anything not a known prose extension counts as code (enforce).
 */
export function isDocsOnlyPath(file) {
  if (!file) return true;
  return /\.(md|mdx|markdown|txt|rst|adoc)$/i.test(file);
}

/**
 * Classify the intent of a change from its touched files.
 * - null  (couldn't determine) -> "code": enforce, never wave through on doubt.
 * - []    (nothing touched)     -> "docs": nothing to compile.
 * - all docs-only paths         -> "docs".
 * - any other path              -> "code".
 */
export function classifyIntent(changedFiles) {
  if (changedFiles == null) return "code";
  const files = changedFiles.filter(Boolean);
  if (files.length === 0) return "docs";
  return files.every(isDocsOnlyPath) ? "docs" : "code";
}

/**
 * Pure decision: what to do given intent + probed readiness. Exported so the
 * heal/block policy is unit-testable without touching a real worktree.
 * @returns {{ action: "ok"|"warn"|"heal", reason: string }}
 */
export function decideReadinessEnforcement({ intent, readinessStatus, optedOut }) {
  if (optedOut) return { action: "warn", reason: "opted-out" };
  if (readinessStatus === "compile-ready") return { action: "ok", reason: "already-compile-ready" };
  if (intent === "docs") return { action: "ok", reason: "docs-intent-source-only-ok" };
  return { action: "heal", reason: "code-intent-source-only" };
}

/**
 * Orchestrate the gate. Dependencies are injectable for testing; defaults call
 * the real probe/bootstrap. Never throws — a gate that crashes on its own
 * bookkeeping must not wedge a thread.
 *
 * @returns {{ ok: boolean, action: string, intent: string, readiness: object,
 *   reason: string, banner?: string[] }}
 */
export function ensureCompileReady({
  worktreePath,
  changedFiles,
  env = process.env,
  probe = probeWorktreeReadiness,
  bootstrap = bootstrapWorktreeDeps,
} = {}) {
  const optedOut = Boolean(env?.DPF_SKIP_COMPILE_READY_GATE);
  let readiness;
  try {
    readiness = probe(worktreePath);
  } catch {
    // Fail-safe: if the cheap probe itself can't run, do not block the thread.
    return { ok: true, action: "probe-failed", intent: classifyIntent(changedFiles), readiness: { status: "unknown" }, reason: "probe-threw" };
  }
  const intent = classifyIntent(changedFiles);
  const decision = decideReadinessEnforcement({ intent, readinessStatus: readiness.status, optedOut });

  if (decision.action !== "heal") {
    return { ok: true, action: decision.action, intent, readiness, reason: decision.reason };
  }

  let healed;
  try {
    healed = bootstrap(worktreePath);
  } catch {
    healed = { status: "source-only", reason: "bootstrap-threw" };
  }
  if (healed.status === "compile-ready") {
    return { ok: true, action: "healed", intent, readiness: healed, reason: "auto-healed-to-compile-ready" };
  }
  return {
    ok: false,
    action: "blocked",
    intent,
    readiness: healed,
    reason: healed.reason ?? "heal-failed",
    banner: formatReadinessBanner(healed, worktreePath),
  };
}
