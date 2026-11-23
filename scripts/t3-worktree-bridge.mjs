#!/usr/bin/env node
// scripts/t3-worktree-bridge.mjs
//
// Temporary bridge between external T3 Code lifecycle hooks
// (`runOnWorktreeCreate` / `runOnSettle`) and DPF's canonical worktree hygiene
// until the internal T3 runtime takes over.
//
// Zero duplicated pruning policy: `on-settle` always delegates to
// `scripts/worktree-janitor.mjs --branch <branch> --tier-a-only`, so dirty,
// unmerged, pinned, leased, or Workroom-claimed trees are never deleted.
//
// USAGE
//   node scripts/t3-worktree-bridge.mjs on-create [--worktree PATH]
//   node scripts/t3-worktree-bridge.mjs on-settle [--worktree PATH] [--branch NAME] [--dry-run]

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseArgs as utilParseArgs } from "node:util";

import { isEntryModule } from "./lib/entry-module.mjs";
import { runGit } from "./lib/git.mjs";
import { scriptArgv } from "./lib/script-argv.mjs";
import { resolveOwningClone } from "./lib/worktree-base.mjs";
import { removeHeartbeat, writeHeartbeat } from "./lib/worktree-session-heartbeat.mjs";

export const T3_BRIDGE_SESSION_ID = "t3-worktree-bridge";

/** Derive a stable Compose project name slug for a linked worktree path. */
export function composeProjectNameForWorktree(worktreePath) {
  const base = path
    .basename(path.resolve(worktreePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `dpf-${base || "worktree"}`;
}

/**
 * Ensure `.env` inside a linked worktree sets `COMPOSE_PROJECT_NAME` so
 * Compose commands never collide with the root `dpf` project. Never overwrites
 * an existing `COMPOSE_PROJECT_NAME` entry.
 */
export function ensureWorktreeComposeProjectName(worktreePath, fsOps = { existsSync, readFileSync, appendFileSync, writeFileSync }) {
  const envPath = path.join(worktreePath, ".env");
  const projectName = composeProjectNameForWorktree(worktreePath);
  if (fsOps.existsSync(envPath)) {
    const existing = fsOps.readFileSync(envPath, "utf8");
    if (/^\s*COMPOSE_PROJECT_NAME\s*=/m.test(existing)) {
      return { updated: false, projectName: null, envPath };
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    fsOps.appendFileSync(envPath, `${prefix}COMPOSE_PROJECT_NAME=${projectName}\n`, "utf8");
    return { updated: true, projectName, envPath };
  }
  fsOps.writeFileSync(envPath, `COMPOSE_PROJECT_NAME=${projectName}\n`, "utf8");
  return { updated: true, projectName, envPath };
}

/**
 * Run the `on-create` bridge hook inside a newly created T3 worktree.
 * Refuses to mutate the owning root clone.
 */
export function runOnCreate({ worktreePath, rootClone, now, pid, fsOps } = {}) {
  const wt = path.resolve(worktreePath ?? process.cwd());
  const root = path.resolve(rootClone ?? resolveOwningClone({ cwd: wt }));
  if (wt === root) {
    return { ok: true, skipped: true, reason: "root clone — bridge only runs in linked worktrees" };
  }
  const compose = ensureWorktreeComposeProjectName(wt, fsOps);
  const heartbeatWritten = writeHeartbeat(wt, {
    now,
    pid,
    sessionId: T3_BRIDGE_SESSION_ID,
    event: "t3-worktree-create",
    ...(fsOps ? { fs: fsOps } : {}),
  });
  return { ok: true, skipped: false, worktreePath: wt, rootClone: root, compose, heartbeatWritten };
}

/**
 * Run the `on-settle` bridge hook when T3 settles a thread (e.g. after linked PR merge).
 * Clears ONLY the bridge's own heartbeat entry and delegates cleanup to DPF's
 * fail-closed Tier-A janitor scoped strictly to this single branch.
 */
export function runOnSettle({
  worktreePath,
  rootClone,
  branch,
  dryRun = false,
  fsOps,
  git = runGit,
  spawn = spawnSync,
} = {}) {
  const wt = path.resolve(worktreePath ?? process.cwd());
  const root = path.resolve(rootClone ?? resolveOwningClone({ cwd: wt }));
  if (wt === root) {
    return { ok: true, skipped: true, reason: "root clone — never reap root" };
  }

  let resolvedBranch = typeof branch === "string" && branch.trim() ? branch.trim() : "";
  if (!resolvedBranch) {
    const r = git(["branch", "--show-current"], { cwd: wt });
    resolvedBranch = r.ok ? r.stdout.trim() : "";
  }
  if (!resolvedBranch || resolvedBranch === "main") {
    return { ok: true, skipped: true, reason: resolvedBranch === "main" ? "on main branch" : "detached HEAD" };
  }

  // Clear only the T3 bridge's own heartbeat slot; leave any other live session intact.
  removeHeartbeat(wt, {
    sessionId: T3_BRIDGE_SESSION_ID,
    ...(fsOps ? { fs: fsOps } : {}),
  });

  const janitorScript = existsSync(path.join(root, "scripts", "worktree-janitor.mjs"))
    ? path.join(root, "scripts", "worktree-janitor.mjs")
    : path.join(wt, "scripts", "worktree-janitor.mjs");

  const cliArgs = [
    janitorScript,
    "--root",
    root,
    "--branch",
    resolvedBranch,
    "--tier-a-only",
    "--allow-fresh",
    dryRun ? "--dry-run" : "--live",
  ];
  // Run from `root` so this process never holds an open CWD inside `wt`.
  const result = spawn(process.execPath, cliArgs, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    skipped: false,
    worktreePath: wt,
    rootClone: root,
    branch: resolvedBranch,
    dryRun,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function parseCli(argv) {
  const { values, positionals } = utilParseArgs({
    args: scriptArgv(argv),
    strict: false,
    allowPositionals: true,
    options: {
      worktree: { type: "string" },
      branch: { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  return {
    command: positionals[0] || "",
    worktreePath: typeof values.worktree === "string" ? values.worktree : undefined,
    branch: typeof values.branch === "string" ? values.branch : undefined,
    dryRun: values["dry-run"] === true,
    help: values.help === true,
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv);
  if (args.help || !args.command) {
    console.log("usage: node scripts/t3-worktree-bridge.mjs <on-create|on-settle> [--worktree PATH] [--branch NAME] [--dry-run]");
    process.exit(args.help ? 0 : 64);
  }
  if (args.command === "on-create") {
    const res = runOnCreate({ worktreePath: args.worktreePath });
    console.log(JSON.stringify(res));
    process.exit(res.ok ? 0 : 1);
  }
  if (args.command === "on-settle") {
    const res = runOnSettle({ worktreePath: args.worktreePath, branch: args.branch, dryRun: args.dryRun });
    if (res.stdout) console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
    if (res.skipped) console.log(`[t3-worktree-bridge] skipped: ${res.reason}`);
    process.exit(res.ok ? 0 : 1);
  }
  console.error(`[t3-worktree-bridge] unknown subcommand: ${args.command}`);
  process.exit(64);
}

if (isEntryModule(import.meta.url)) {
  main();
}
