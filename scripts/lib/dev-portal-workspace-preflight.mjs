#!/usr/bin/env node
/**
 * BI-0DF1F354 — Contributor preview (dev-portal) must not crash-loop forever
 * when its bind-mounted worktree is removed.
 *
 * Contract (enforced by unit tests + entrypoint):
 *  1. Assess workspace at DPF_DEV_PORTAL_WORKSPACE_ROOT (default /workspace).
 *  2. On FAIL: print diagnosis, exit **non-zero** from this process so the
 *     entrypoint can branch (must NOT use `preflight && pnpm` with exit 0 on
 *     fail — that would continue into pnpm).
 *  3. Entrypoint on FAIL: exit **0** without running pnpm/next so Docker
 *     `on-failure` does not thrash (observed live: 262 restarts).
 *  4. This script is **baked into the image** at
 *     `/usr/local/bin/dev-portal-workspace-preflight.mjs` because the primary
 *     failure mode is a deleted/empty bind mount — the worktree copy of this
 *     file is not available when the mount is gone.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ ok: true } | { ok: false; reason: string; detail: string }} PreflightResult
 * @typedef {{
 *   action: "start" | "stop-clean",
 *   runInstallAndDev: boolean,
 *   processExitCode: number,
 *   preflightCliExitCode: number,
 * }} DevPortalBootPlan
 */

/** CLI exit when workspace is unusable — non-zero so entrypoint can gate pnpm. */
export const PREFLIGHT_FAIL_EXIT = 1;

/**
 * True when `root` looks like a usable DPF workspace mount for dev-portal.
 * @param {string} root
 * @param {{ existsSync?: typeof existsSync; readFileSync?: typeof readFileSync; statSync?: typeof statSync }} [io]
 * @returns {PreflightResult}
 */
export function assessDevPortalWorkspace(root, io = {}) {
  const exists = io.existsSync ?? existsSync;
  const read = io.readFileSync ?? readFileSync;
  const stat = io.statSync ?? statSync;

  if (!root || typeof root !== "string" || root.trim().length === 0) {
    return {
      ok: false,
      reason: "missing-root",
      detail: "Workspace root path is empty. Set DPF_DEV_WORKTREE to an absolute worktree path.",
    };
  }

  let isDir = false;
  try {
    isDir = stat(root).isDirectory();
  } catch {
    return {
      ok: false,
      reason: "root-missing",
      detail: `Workspace root does not exist: ${root}. The leased worktree was probably removed — release the :3001 lease and claim a live worktree.`,
    };
  }
  if (!isDir) {
    return {
      ok: false,
      reason: "root-not-directory",
      detail: `Workspace root is not a directory: ${root}`,
    };
  }

  const packageJsonPath = join(root, "package.json");
  if (!exists(packageJsonPath)) {
    return {
      ok: false,
      reason: "package-json-missing",
      detail:
        `No package.json under ${root}. The bind mount is empty or the worktree was deleted. ` +
        "Stop crash-looping: release the dev-portal lease, re-claim with a live worktree, then compose up again.",
    };
  }

  try {
    const raw = read(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw);
    if (!pkg || typeof pkg !== "object") {
      return {
        ok: false,
        reason: "package-json-invalid",
        detail: `package.json under ${root} is not a JSON object.`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: "package-json-unreadable",
      detail: `Could not read package.json under ${root}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const webPkg = join(root, "apps", "web", "package.json");
  if (!exists(webPkg)) {
    return {
      ok: false,
      reason: "web-package-missing",
      detail:
        `apps/web/package.json missing under ${root}. This is not a DPF monorepo mount — refusing to start dev-portal so it does not crash-loop.`,
    };
  }

  return { ok: true };
}

/**
 * Pure boot plan used by the image entrypoint (and integration tests).
 * Missing workspace: never run pnpm; container exits 0 (no restart thrash).
 * Healthy workspace: run install+dev; preflight CLI exits 0.
 * @param {PreflightResult} result
 * @returns {DevPortalBootPlan}
 */
export function planDevPortalBoot(result) {
  if (result.ok) {
    return {
      action: "start",
      runInstallAndDev: true,
      processExitCode: 0,
      preflightCliExitCode: 0,
    };
  }
  return {
    action: "stop-clean",
    runInstallAndDev: false,
    processExitCode: 0,
    preflightCliExitCode: PREFLIGHT_FAIL_EXIT,
  };
}

/**
 * Exit code for the **preflight CLI process alone** (not the container).
 * Fail → non-zero so entrypoint can skip pnpm. Success → 0.
 * @param {PreflightResult} result
 * @returns {number}
 */
export function preflightExitCode(result) {
  return planDevPortalBoot(result).preflightCliExitCode;
}

/**
 * Simulate the baked entrypoint shell contract without Docker.
 * @param {PreflightResult} result
 * @returns {{ ranPnpm: boolean; finalExit: number; action: string }}
 */
export function simulateDevPortalEntrypoint(result) {
  const plan = planDevPortalBoot(result);
  if (!plan.runInstallAndDev) {
    return { ranPnpm: false, finalExit: plan.processExitCode, action: plan.action };
  }
  return { ranPnpm: true, finalExit: plan.processExitCode, action: plan.action };
}

/**
 * Human-facing banner when the preflight fails.
 * @param {PreflightResult} result
 * @returns {string}
 */
export function formatPreflightFailure(result) {
  if (result.ok) return "";
  return [
    "[dev-portal-preflight] STOPPING — refusing to crash-loop on a missing/invalid worktree (BI-0DF1F354).",
    `[dev-portal-preflight] reason=${result.reason}`,
    `[dev-portal-preflight] ${result.detail}`,
    "[dev-portal-preflight] Next: scripts/dev-portal-lease.sh release (if held), then claim a live worktree and restart dev-portal.",
  ].join("\n");
}

function main() {
  const root = process.env.DPF_DEV_PORTAL_WORKSPACE_ROOT || process.cwd();
  const result = assessDevPortalWorkspace(root);
  if (result.ok) {
    process.stdout.write(`[dev-portal-preflight] ok workspace=${root}\n`);
    process.exit(0);
  }
  process.stderr.write(`${formatPreflightFailure(result)}\n`);
  // Non-zero so entrypoint does not run pnpm (BI-0DF1F354). Entrypoint maps this to container exit 0.
  process.exit(preflightExitCode(result));
}

// Self-contained mirror of scripts/lib/entry-module.mjs `isEntryModule` — this
// file is baked ALONE into the image at /usr/local/bin (Dockerfile), where a
// relative import cannot resolve. Realpath both spellings so a symlinked
// invocation path (macOS /var tmpdir) cannot make the guard silently skip main().
function isEntryScript() {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  const thisFile = fileURLToPath(import.meta.url);
  if (argvPath === thisFile) return true;
  try {
    return realpathSync(argvPath) === realpathSync(thisFile);
  } catch {
    return false;
  }
}

if (isEntryScript()) {
  main();
}
