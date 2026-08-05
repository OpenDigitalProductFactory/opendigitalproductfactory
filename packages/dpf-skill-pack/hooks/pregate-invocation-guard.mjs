#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/pregate-invocation-guard.mjs
//
// PreToolUse guard (BI-B1065D41 Phase 3): refuse a `pregate` invocation shaped
// so it CANNOT succeed, or so its verdict cannot be read.
//
// Why a hook and not another paragraph. On 2026-08-04 roughly an hour was lost
// to four failed pregate invocations. Not one was a knowledge gap — every
// governing rule was already in the operator's context, in prose, and was
// violated anyway. That is the signal: a rule that lives only in prose is
// advisory at the moment of the tool call. Prose carries the WHY; hooks carry
// the WHAT. If violating a rule costs an hour, it belongs in a hook.
//
// The four shapes, and what each actually does:
//
//   1. PIPED (`pregate | head`, `| grep`) — when the reader exits, the write
//      fails and the run dies mid-install holding a shared lease. Killed three
//      runs. Phase 1 makes the gate survive this AND removes the reason to pipe
//      (~30 lines of stdout instead of ~28,000), so by the time you read this a
//      pipe merely degrades. It is still denied: it truncates the verdict block
//      whose LAST line is the verdict, so a piped run is unreadable by
//      construction.
//   2. BACKGROUNDED (`&`, or the harness's run_in_background) — the harness caps
//      and kills a backgrounded command mid-install. The FOREGROUND form is the
//      one that survives: on timeout the harness migrates it to background and
//      it CONTINUES. This is the opposite of the intuitive choice for a
//      long-running command, and nothing at the call site said so until now.
//   3. CHAINED (`pregate; echo $?; tail ...`) — the reported status is the LAST
//      command's. An operator read tail's exit 0 as the gate verdict.
//   4. TIME-BOUNDED (`timeout 600 pregate`) — cuts the run off mid-queue and
//      manufactures a false green; the record is left pinned to the old SHA.
//
// The denial always names the canonical form, because a guard that only says no
// converts a wrong invocation into a stuck session.
//
// Structurally identical to compose-guard.mjs (the established pattern in this
// directory, five guards over): pure `decide()` for tests, dual-envelope deny so
// Claude/Codex/Grok all honor it, DPF-workspace scoped, and FAIL OPEN on any
// parse/IO error — a guard must never wedge a session.

import {
  readHookPayload,
  isShellTool,
  emitDeny,
  inDpfWorkspace,
  shellCommandFromInput,
} from "./lib/hook-io.mjs";
import { executableCommandText } from "./command-text.mjs";

/** `pnpm run pregate`, `pnpm pregate`, or the scripts it fronts. */
const PREGATE_PATTERNS = [
  /\bpnpm\s+(?:run\s+)?pregate\b/,
  /\bnode\s+\S*scripts[/\\]pregate\.mjs\b/,
  /\bscripts[/\\]gate-worktree\.(?:mjs|sh)\b/,
];

// The read-only sibling command is safe in every shape — it reads a record in
// milliseconds and holds nothing. Denying `pregate:status | jq` would punish the
// exact habit this BI wants to encourage.
const STATUS_PATTERNS = [
  /\bpnpm\s+(?:run\s+)?pregate:status\b/,
  /\bnode\s+\S*scripts[/\\]pregate-status\.mjs\b/,
];

// Cheap, non-admitting pregate modes. `--dry-run` prints a plan and exits; the
// contract tests and routing probes legitimately pipe them.
const CHEAP_MODES = [/--dry-run\b/, /--help\b/, /\s-h\b/];

const CANONICAL =
  "Canonical form — run it as the SOLE command, in the FOREGROUND, unpiped:\n"
  + "    pnpm run pregate\n"
  + "On timeout the harness migrates a foreground run to the background and it CONTINUES; "
  + "that is the working path. Read the verdict afterwards with `pnpm run pregate:status` "
  + "(exit 0 only for a PASS bound to the current HEAD) — not the exit code, not the log tail. "
  + "For the full transcript use the log path pregate prints, or DPF_PREGATE_VERBOSE=1. "
  + "Deliberate exception: prefix the command with DPF_ALLOW_PREGATE_SHAPE=1.";

/** Segment separators that let a later command's exit status surface. */
function hasTrailingChain(text) {
  // `&&` is fine: it short-circuits, so a failing pregate stops the chain and
  // the shell's status is still pregate's. `;` and `||` are not — both run the
  // next command REGARDLESS and hand you its status instead.
  return /(?:;|\|\|)\s*\S/.test(text);
}

function hasPipe(text) {
  // Match a real pipe, not the `||` operator.
  return /\|(?!\|)/.test(text.replace(/\|\|/g, ""));
}

function isBackgrounded(text) {
  // Trailing `&`, but not `&&`.
  return /&\s*$/.test(text.replace(/&&/g, "")) || /&\s*(?:[;\n]|$)/.test(text.replace(/&&/g, ""));
}

function isTimeBounded(text) {
  return /\b(?:timeout|gtimeout)\s+[\d.]+[smhd]?\b/.test(text);
}

/**
 * Pure decision. Exported for tests.
 * @param {{ command: string, env?: Record<string,string|undefined>, runInBackground?: boolean }} args
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide({ command, env = {}, runInBackground = false }) {
  if (typeof command !== "string" || command.trim() === "") return { block: false };
  if (env.DPF_ALLOW_PREGATE_SHAPE === "1" || /\bDPF_ALLOW_PREGATE_SHAPE=1\b/.test(command)) {
    return { block: false };
  }

  const text = executableCommandText(command);
  if (STATUS_PATTERNS.some((re) => re.test(text))) return { block: false };
  if (!PREGATE_PATTERNS.some((re) => re.test(text))) return { block: false };
  if (CHEAP_MODES.some((re) => re.test(text))) return { block: false };

  const faults = [];
  if (runInBackground === true) {
    faults.push(
      "run_in_background was set — the harness CAPS and KILLS a backgrounded run mid-install",
    );
  }
  if (isBackgrounded(text)) {
    faults.push("the command is backgrounded with `&` — the run is capped and killed mid-install");
  }
  if (hasPipe(text)) {
    faults.push(
      "the command is PIPED — the verdict is the LAST line of the closing block, so a truncating "
      + "reader removes exactly the line you need (and before BI-B1065D41 the closing pipe "
      + "SIGPIPE-killed the run outright)",
    );
  }
  if (hasTrailingChain(text)) {
    faults.push(
      "another command is chained after pregate with `;` or `||` — the shell then reports THAT "
      + "command's exit code, not the gate's",
    );
  }
  if (isTimeBounded(text)) {
    faults.push(
      "the run is wrapped in `timeout` — it gets cut off mid-queue, which manufactures a false "
      + "green and leaves a stale lease pinned to the old SHA",
    );
  }

  if (faults.length === 0) return { block: false };
  return {
    block: true,
    reason: `Local-CI gate invocation blocked (BI-B1065D41): ${faults.join("; ")}.\n${CANONICAL}`,
  };
}

// ── runtime entry ────────────────────────────────────────────────────────────

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open on read/parse error
  if (!inDpfWorkspace(payload.cwd)) process.exit(0);
  if (!isShellTool(payload.toolName)) process.exit(0);

  const command = shellCommandFromInput(payload.toolInput);
  const runInBackground = payload.toolInput?.run_in_background === true
    || payload.toolInput?.runInBackground === true;
  const verdict = decide({ command, env: process.env, runInBackground });
  if (!verdict.block) process.exit(0);

  emitDeny(verdict.reason);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("pregate-invocation-guard.mjs")) {
  main();
}
