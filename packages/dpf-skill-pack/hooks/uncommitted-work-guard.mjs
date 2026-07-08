#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/uncommitted-work-guard.mjs
//
// Process-spine P0 guard (BI-38578194, spec §6.3): warn before durable-artifact
// loss on branch switch or session end. Scans tracked-but-uncommitted and
// untracked files under docs/superpowers/specs|plans/. Non-blocking — emits a
// loud warning and always exits 0. Escape hatch: DPF_SKIP_UNCOMMITTED_WORK_GUARD=1.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { findDurableArtifactDrift, buildWarning } from "./uncommitted-work-scan.mjs";

function skipGuard(env = process.env) {
  return env.DPF_SKIP_UNCOMMITTED_WORK_GUARD === "1";
}

function repoRoot(explicit) {
  if (explicit) return explicit;
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim();
  return process.cwd();
}

function gitPorcelain(cwd) {
  try {
    const r = spawnSync("git", ["-C", cwd, "status", "--porcelain"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (r.status !== 0 || !r.stdout) return [];
    return r.stdout.split("\n").filter((line) => line.trim() !== "");
  } catch {
    return [];
  }
}

function emitClaudeWarning(warning, hookEventName) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        additionalContext: warning,
      },
    }),
  );
}

function main() {
  if (skipGuard()) process.exit(0);

  const argv = process.argv.slice(2);
  const gitHookIdx = argv.indexOf("--git-hook");
  const isGitHook = gitHookIdx >= 0;
  const hookKind = isGitHook ? argv[gitHookIdx + 1] : null;
  const rootArgIdx = argv.indexOf("--repo-root");
  const baseDir = repoRoot(rootArgIdx >= 0 ? argv[rootArgIdx + 1] : null);

  const drift = findDurableArtifactDrift(gitPorcelain(baseDir));
  if (drift.length === 0) process.exit(0);

  const warning = buildWarning(drift, { context: isGitHook ? "post-checkout" : "session-end" });

  if (isGitHook) {
    process.stderr.write(`\n${warning}\n\n`);
    process.exit(0);
  }

  let hookEventName = "SessionEnd";
  try {
    const raw = readFileSync(0, "utf8");
    const payload = raw ? JSON.parse(raw) : {};
    if (payload?.hook_event_name === "Stop" || payload?.hookEventName === "Stop") {
      hookEventName = "Stop";
    }
  } catch {
    // stdin optional for direct invocation — default SessionEnd shape
  }

  emitClaudeWarning(warning, hookEventName);
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("uncommitted-work-guard.mjs")) {
  main();
}