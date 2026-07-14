#!/usr/bin/env node
/**
 * BI-0DF1F354 — Contributor preview (dev-portal) must not crash-loop forever
 * when its bind-mounted worktree is removed.
 *
 * Docker `restart: unless-stopped` restarts the container on every non-zero
 * (and even some zero) failure path until an operator intervenes. When
 * DPF_DEV_WORKTREE points at a deleted worktree, the /workspace mount is empty
 * or missing package.json and `pnpm install` / `next dev` thrash forever
 * (observed: 262 restarts) with no Platform Health signal that the *cause* is
 * a missing worktree.
 *
 * This preflight runs before pnpm/next in the Dockerfile `dev` stage CMD.
 * If the workspace root is not a DPF monorepo, it prints a clear diagnosis and
 * exits 0 so Docker does not treat the stop as a crash worth restarting.
 *
 * Pure helpers are exported for unit tests (Node test runner / vitest via
 * dynamic import).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {{ ok: true } | { ok: false; reason: string; detail: string }} PreflightResult
 */

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
    // Prefer a monorepo marker (pnpm-workspace style name) but accept any
    // package.json with a name so local forks still pass.
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
 * Exit code for Docker: 0 = intentional stop (do not thrash restarts),
 * 1 = unexpected CLI misuse. Missing workspace uses exit 0 by design.
 * @param {PreflightResult} result
 * @returns {number}
 */
export function preflightExitCode(result) {
  return result.ok ? 0 : 0;
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
  // Exit 0 so Docker restart policies do not treat this as a crash (BI-0DF1F354).
  process.exit(preflightExitCode(result));
}

const entry = typeof process.argv[1] === "string" ? process.argv[1].replace(/\\/g, "/") : "";
const isMain =
  entry.endsWith("/dev-portal-workspace-preflight.mjs")
  || entry.endsWith("dev-portal-workspace-preflight.mjs");

if (isMain) {
  main();
}
