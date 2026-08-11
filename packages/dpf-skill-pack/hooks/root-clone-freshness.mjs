#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/root-clone-freshness.mjs
//
// SessionStart hook (EP-PROCESS-SPINE, plan 2026-08-11-worktree-lifecycle-hygiene).
//
// Keep the shared root clone fast-forwarded to origin/main at the start of every
// session, on every surface (Claude/Codex/Grok) — because all peer worktrees
// junction @dpf/* workspace packages into the root tree, so a stale root makes
// `pregate-preflight` abort with "Stale root clone detected (BI-A900EA3F)" for
// EVERY worktree until someone fast-forwards the root. A SessionStart hook is the
// robust cross-surface remediation: session hooks fire wherever dpf-platform is
// installed, whereas a portal cron can go dark or not see host worktrees.
//
// Fast-forward ONLY, and only when the root is on main + clean (see
// scripts/lib/root-clone-refresh.mjs). It runs the SAFE `git merge --ff-only`
// directly (not via the Bash tool), which is exactly the remedy root-clone-guard.mjs
// tells the operator to run — so it complements that guard rather than fighting it.
//
// Fail-open. Escape hatch: DPF_SKIP_ROOT_CLONE_REFRESH=1.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inDpfWorkspace } from "./lib/hook-io.mjs";

const hooksDir = dirname(fileURLToPath(import.meta.url));
const skillPackRoot = resolve(hooksDir, "..");
const repoRootGuess = resolve(skillPackRoot, "../..");

function loadRefreshLib() {
  const candidates = [
    join(repoRootGuess, "scripts/lib/root-clone-refresh.mjs"),
    join(skillPackRoot, "../../scripts/lib/root-clone-refresh.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  return null;
}

function runGit(args, cwd) {
  const r = spawnSync("git", args, {
    cwd: cwd || undefined,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim() };
}

function readPayload() {
  try {
    const raw = readFileSync(0, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sessionCwd(payload) {
  return payload.cwd || payload.workspaceRoot || payload.workspace_root || process.cwd();
}

/** The root/main clone that owns this cwd's git-common-dir. */
function resolveRootClone(cwd) {
  const common = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (!common.ok || !common.stdout) return null;
  return common.stdout.replace(/[/\\]\.git$/, "");
}

function emitContext(text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
    }),
  );
}

async function main() {
  if (process.env.DPF_SKIP_ROOT_CLONE_REFRESH === "1") process.exit(0);

  const payload = readPayload();
  const cwd = sessionCwd(payload);
  if (!inDpfWorkspace(cwd)) process.exit(0);

  const rootClone = resolveRootClone(cwd);
  if (!rootClone) process.exit(0);

  const lib = await loadRefreshLib();
  if (!lib?.refreshRootClone) process.exit(0);

  let result;
  try {
    result = lib.refreshRootClone({ rootClonePath: rootClone });
  } catch {
    process.exit(0); // fail-open
  }

  // Only speak up when it did something or when it REFUSED because the root is in a
  // state that blocks every worktree's pregate (off-main / dirty) — that is
  // actionable. A clean "already current" skip stays silent.
  if (result.action === "ff") {
    emitContext(
      `Root-clone freshness: ${result.reason} at ${rootClone}. Junctioned worktrees now see current main.`,
    );
  } else if (result.action === "refuse") {
    emitContext(
      `Root-clone freshness: ${result.reason} at ${rootClone}. ` +
        `While the root is behind/off-main, every junctioned worktree's pregate can abort with ` +
        `"Stale root clone detected (BI-A900EA3F)". Return the root clone to a clean 'main' so it can fast-forward.`,
    );
  } else if (result.action === "failed") {
    emitContext(`Root-clone freshness: ${result.reason} at ${rootClone}.`);
  }
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("root-clone-freshness.mjs")) {
  main().catch(() => process.exit(0));
}
