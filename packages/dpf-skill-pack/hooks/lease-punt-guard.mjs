#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/lease-punt-guard.mjs
//
// PreToolUse guard (BI-2D167283, EP-5560770F — Gate B of the harness-enforced
// decision-routing + lease-punt spec, docs/superpowers/specs/2026-07-03-...).
//
// A topic worktree is SOURCE CONTROL, not runtime (AGENTS.md §4/§5). It has no
// DATABASE_URL by design, so a runtime-bound gate — `prisma migrate dev` (needs
// a shadow DB), `prisma migrate deploy`, `prisma db push`, `next build` against
// the production bundle — cannot produce canonical evidence there. The rulebook
// routes those gates through the SHARED local-CI convergence sandbox via
// `claim_nonprod_environment_lease(environmentKey="local-integration-ci")`.
//
// The observed failure (that this guard exists to stop): a session hit "no
// DATABASE_URL", correctly hand-authored its migration, then PUNTED the gates as
// "unrun / CI will handle it" WITHOUT claiming the lease. This guard turns that
// silent punt into an actionable redirect — a `prisma migrate` with no DB fails
// confusingly anyway, so redirecting is strictly helpful (hard deny); `next
// build` may legitimately run, so it only warns.
//
// Decision protocol (mirrors lease-guard.mjs): to DENY, emit the PreToolUse
// permissionDecision JSON and exit 0; to WARN, emit additionalContext and exit 0;
// to ALLOW, exit 0 with no output. Fails OPEN on any parse/IO error — a guard
// must never wedge the session. Shipped INSIDE the dpf-platform plugin so it
// travels to every surface.

import {
  readHookPayload,
  isShellTool,
  emitDeny,
  emitContext,
  inDpfWorkspace,
  shellCommandFromInput,
} from "./lib/hook-io.mjs";

import { executableCommandText } from "./command-text.mjs";

// Gates that CANNOT meaningfully run in a source-only worktree (need a live DB /
// shadow DB). A hard deny + lease redirect — they fail without a DB regardless.
const HARD_GATE_PATTERNS = [
  /\bprisma\s+migrate\s+(dev|deploy|reset)\b/,
  /\bprisma\s+db\s+push\b/,
];

// Gates that produce canonical-bundle evidence but may still run locally; nudge
// toward the lease for real evidence rather than blocking.
const WARN_GATE_PATTERNS = [/\bnext\s+build\b/];

// If any appears, the command is going through (or explicitly bypassing) the
// governed lease path — allow it.
const GOVERNED_MARKERS = [
  /claim_nonprod_environment_lease/,
  /local-integration-ci/,
  /dev-portal-lease\.sh/,
  /gate-worktree\.sh/,
  /DPF_ALLOW_UNLEASED_GATE=1/,
];

const DENY_GUIDANCE =
  "Runtime-bound gate blocked in a source-only worktree with no DATABASE_URL (BI-2D167283). " +
  "A worktree is source control, not runtime (AGENTS.md §4/§5) — `prisma migrate` needs a live/shadow DB it does not have here, so this will fail. " +
  "Do NOT punt it as 'unrun / CI will handle it'. Route it through the shared sandbox: claim_nonprod_environment_lease(environmentKey=\"local-integration-ci\") (MCP), run the gate on the leased runtime, record the lease id + output as PR evidence, release. " +
  "If you are deliberately deferring, record an EXPLICIT deferral in the PR (name the gate + where it will run) — never a silent 'unrun'. Emergency bypass: prefix DPF_ALLOW_UNLEASED_GATE=1.";

const WARN_GUIDANCE =
  "[lease-punt] `next build` here builds against a non-canonical tree with no DATABASE_URL. " +
  "For canonical-bundle evidence, run it through the shared sandbox lease (claim_nonprod_environment_lease environmentKey=\"local-integration-ci\") and record the output in the PR, " +
  "rather than declaring the build gate 'unrun'. This is a nudge, not a block.";

/**
 * Pure decision: how should this Bash command be handled? Exported for tests.
 * A runtime-bound gate is only intercepted when DATABASE_URL is ABSENT (the
 * source-only-worktree signal); when it is set (canonical install / leased env
 * that exported it) the gate can run and we allow it — out of scope here.
 * @param {string} command
 * @param {Record<string,string|undefined>} env
 * @returns {{ action: "deny"|"warn"|"allow", reason?: string }}
 */
export function decide(command, env = {}) {
  if (typeof command !== "string" || command.trim() === "") return { action: "allow" };
  if (GOVERNED_MARKERS.some((re) => re.test(command))) return { action: "allow" };
  // DATABASE_URL present => a runnable runtime (canonical or leased). Not our case.
  if (typeof env.DATABASE_URL === "string" && env.DATABASE_URL.trim() !== "") return { action: "allow" };
  // Gate patterns run against the EXECUTABLE text only — quoted data (evidence
  // summaries, commit messages, node -e scripts, heredoc bodies) mentioning
  // `prisma migrate` must not deny; a real invocation (incl. `sh -c '…'`
  // payloads) still does. Markers above stay raw-matched (allow-direction).
  const executable = executableCommandText(command);
  if (HARD_GATE_PATTERNS.some((re) => re.test(executable))) return { action: "deny", reason: DENY_GUIDANCE };
  if (WARN_GATE_PATTERNS.some((re) => re.test(executable))) return { action: "warn", reason: WARN_GUIDANCE };
  return { action: "allow" };
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open on read/parse error
  if (!inDpfWorkspace(payload.cwd)) process.exit(0); // DPF-scoped global hook: enforce only inside a DPF checkout

  // Shell tool across surfaces (Bash / Shell / run_terminal_command).
  if (!isShellTool(payload.toolName)) process.exit(0);
  const command = shellCommandFromInput(payload.toolInput);
  const verdict = decide(command, process.env);
  if (verdict.action === "allow") process.exit(0);

  // Dual-envelope emit: deny hard-blocks on every surface; warn is Claude-only
  // additionalContext (Grok has no non-blocking channel and ignores it).
  if (verdict.action === "deny") emitDeny(verdict.reason);
  emitContext(verdict.reason);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("lease-punt-guard.mjs")) {
  main();
}
