#!/usr/bin/env node
// pregate.mjs — host-native/Node-first entry point for `pnpm run pregate`
// (BI-2272D840).
//
// Context: BI-C22152E7 hit a Codex Windows worktree where the automatic
// `pnpm run pregate` path (`sh scripts/gate-worktree.sh`) could not run —
// native POSIX `sh` was unavailable and WSL could not cleanly read the
// Windows worktree's `.git` indirection. That is harness friction, not a
// product blocker (docs/testing/pre-pr-gate.md), but the process depended on
// the agent recognizing that doctrine and hand-driving the sandbox lease
// steps manually instead of it just working.
//
// This wrapper detects whether `sh` actually works against THIS worktree
// (not just "sh is on PATH" — the failure mode above is a shell that starts
// but cannot see the worktree's git state) and routes accordingly:
//   - sh works here            -> delegate to `sh scripts/gate-worktree.sh`
//                                  (unchanged contract, zero behavior change).
//   - sh missing or non-functional -> run scripts/gate-worktree.mjs, the
//                                  Node-native port of the same lease-claim /
//                                  run / evidence-record / lease-release flow.
// Either path ends at the same governed local-integration-ci sandbox lease —
// a no-native-sh host is sandbox-routable, never a build blocker.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(THIS_FILE);

// Host-side guard parity preflight (BI-D35433FB): run the deterministic CI
// policy guards before lease admission so a doomed gate never occupies a
// contended local-integration-ci sandbox slot. Routing probes (--dry-run) and
// evidence replays (--finalize-evidence) change nothing about the tree and
// skip it; DPF_SKIP_PREGATE_PREFLIGHT_REASON is the recorded emergency skip.
export function shouldRunPreflight(args, env = process.env) {
  if (args.includes("--dry-run") || args.includes("--finalize-evidence")) return false;
  if (env.DPF_SKIP_PREGATE_PREFLIGHT_REASON) return false;
  return true;
}

export function detectWorkingShell({ cwd = process.cwd(), spawnSyncImpl = spawnSync } = {}) {
  if (process.env.DPF_PREGATE_FORCE_NODE === "1") return false;
  if (process.env.DPF_PREGATE_FORCE_SH === "1") return true;
  try {
    const result = spawnSyncImpl("sh", ["-c", "git rev-parse --show-toplevel"], { cwd, encoding: "utf8" });
    return result.status === 0 && !result.error && Boolean(result.stdout && result.stdout.trim());
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);

  if (shouldRunPreflight(args)) {
    const preflight = spawnSync(
      process.execPath,
      [join(SCRIPT_DIR, "pregate-preflight.mjs")],
      { stdio: "inherit" },
    );
    if (preflight.error || (preflight.status ?? 1) !== 0) {
      process.stderr.write(
        "pregate: guard parity preflight failed — fix the deterministic guard failures above before the sandbox gate runs (no lease was claimed).\n",
      );
      process.exit(preflight.status ?? 1);
    }
  } else if (process.env.DPF_SKIP_PREGATE_PREFLIGHT_REASON) {
    process.stderr.write(
      `pregate: guard parity preflight SKIPPED — DPF_SKIP_PREGATE_PREFLIGHT_REASON=${process.env.DPF_SKIP_PREGATE_PREFLIGHT_REASON}\n`,
    );
  }

  const shWorks = detectWorkingShell();

  let result;
  if (shWorks) {
    result = spawnSync("sh", [join(SCRIPT_DIR, "gate-worktree.sh"), ...args], { stdio: "inherit" });
  } else {
    process.stderr.write("pregate: no working native sh detected for this worktree — routing through the Node-native gate (scripts/gate-worktree.mjs).\n");
    result = spawnSync(process.execPath, [join(SCRIPT_DIR, "gate-worktree.mjs"), ...args], { stdio: "inherit" });
  }

  if (result.error) {
    process.stderr.write(`pregate: failed to launch gate: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

// Guard against side effects on import (e.g. from tests importing
// detectWorkingShell) — only run when this file is the process entry point.
if (process.argv[1] === THIS_FILE) main();
