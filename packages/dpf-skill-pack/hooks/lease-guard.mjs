#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/lease-guard.mjs
//
// PreToolUse guard (BI-4043A64B enforcement pillar): refuse an UNGOVERNED
// dev-server / runtime launch from a Claude session. On a single shared
// nonprod instance, a raw `pnpm dev` / `next dev` / `dev-portal-start` in a
// worktree is exactly how ~50 rogue background servers accumulated and starved
// the machine. The governed paths register a lease (so the server is tracked,
// heartbeated, and reaped) or run on an isolated runtime; this hook blocks the
// raw launch and points at them.
//
// Shipped INSIDE the dpf-platform plugin (hooks/hooks.json, matcher "Bash") so
// the guard travels with the plugin to every surface — NOT through run-hook.mjs,
// which forces exit 0 and so could never deny. Node is the one runtime
// guaranteed cross-platform for Claude Code hooks. (BI-CA0ED781 moved this from
// repo .claude/settings.json into the plugin.)
//
// Decision protocol: to DENY, emit the PreToolUse permissionDecision JSON on
// stdout and exit 0; to ALLOW, exit 0 with no output. The hook fails OPEN — any
// parse/IO error allows the command (a guard must never wedge the session).

import {
  readHookPayload,
  isShellTool,
  emitDeny,
  inDpfWorkspace,
  shellCommandFromInput,
} from "./lib/hook-io.mjs";

import { executableCommandText } from "./command-text.mjs";

// Raw dev-server / preview launchers that spawn an untracked long-lived process.
// Deliberately NOT docker-compose (legit platform-stack infra) — scoped to the
// dev-server vectors behind the rogue-server incidents.
const BLOCK_PATTERNS = [
  // `dev` as a standalone script arg after a package runner — covers
  // `pnpm dev`, `pnpm run dev`, `pnpm --filter web dev`, `npm/yarn dev`.
  // `\sdev(?:\s|$)` requires whitespace before `dev` so `--save-dev` / `some-dev`
  // / `devDependencies` do not match. `[^\n&|;]*` stops at command separators.
  /\b(?:pnpm|npm|yarn)\b[^\n&|;]*\sdev(?:\s|$)/,
  /\bnext\s+dev\b/,
  /\bturbo\b[^\n&|;]*\sdev(?:\s|$)/,
  /\bdev-portal-start\b/,
];

// Governed wrappers + the explicit operator bypass. If any appears in the
// command, the launch is allowed (it goes through the lease/isolated path).
const GOVERNED_MARKERS = [
  /dev-portal-lease\.sh/,
  /gate-worktree\.sh/,
  /claim_nonprod_environment_lease/,
  /DPF_ALLOW_UNGATED_SERVER=1/,
];

const GUIDANCE =
  "Ungoverned dev-server launch blocked (BI-4043A64B). On the single shared nonprod instance this is how rogue background servers pile up and exhaust the machine. " +
  "Use a governed path: claim_nonprod_environment_lease (MCP) then run on the leased runtime, or scripts/dev-portal-lease.sh, or run long-lived work in an isolated worktree compose stack. " +
  "Emergency bypass: prefix the command with DPF_ALLOW_UNGATED_SERVER=1.";

/**
 * Pure decision: should this Bash command be blocked? Exported for unit tests.
 * @param {string} command
 * @param {Record<string,string|undefined>} env
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide(command, env = {}) {
  if (typeof command !== "string" || command.trim() === "") return { block: false };
  if (env.DPF_ALLOW_UNGATED_SERVER === "1") return { block: false };
  if (GOVERNED_MARKERS.some((re) => re.test(command))) return { block: false };
  // Block patterns run against the EXECUTABLE text only — a commit message or
  // echoed string mentioning `pnpm dev` is data, not a server launch; a real
  // launch (incl. `sh -c '…'` payloads) still matches. Markers above stay
  // raw-matched (allow-direction).
  const hit = BLOCK_PATTERNS.some((re) => re.test(executableCommandText(command)));
  if (!hit) return { block: false };
  return { block: true, reason: GUIDANCE };
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open on read/parse error
  if (!inDpfWorkspace(payload.cwd)) process.exit(0); // DPF-scoped global hook: enforce only inside a DPF checkout

  // Only a shell tool launches a server; ignore every other tool (Bash / Shell / run_terminal_command).
  if (!isShellTool(payload.toolName)) process.exit(0);
  const command = shellCommandFromInput(payload.toolInput);
  const verdict = decide(command, process.env);
  if (!verdict.block) process.exit(0);

  emitDeny(verdict.reason); // dual-envelope deny — blocks on every surface
}

// Run only when invoked directly (not when imported by the test).
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("lease-guard.mjs")) {
  main();
}
