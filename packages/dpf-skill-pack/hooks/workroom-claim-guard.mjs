#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/workroom-claim-guard.mjs
//
// PreToolUse guard (BI-865E1755): refuse to mutate a DPF worktree that no live
// Workroom claims.
//
// WHY
// AGENTS.md §12 and kernel principle `claim-a-workroom-before-you-work` require
// a claim before work. NOTHING enforced it. `grep -rn claim_workroom_scope
// packages/dpf-skill-pack/` returned zero hits — not one hook, not one skill,
// including dpf-worktree-per-session (the skill that fires exactly when a
// thread starts work) and worktree-create.mjs (the natural enforcement point).
// Live consequence 2026-08-22: 80 worktrees on disk, 0 holding a live capsule,
// 41 of 50 capsules reap-candidates. The coordination plane was reasoning about
// a fiction.
//
// THE Bash MATCHER IS NOT OPTIONAL
// Bypass permissions mode routes file edits through Bash, around every
// Write|Edit|MultiEdit hook. A guard wired only to the file tools is trivially
// and accidentally defeated, so mutating shell commands are gated too.
//
// FAIL CLOSED, WITH ONE NAMED DOOR
// A check that cannot be evaluated is not a pass. But a guard that bricks every
// worktree when the portal is down is its own catastrophe, so there is exactly
// one documented escape: DPF_WORKROOM_BYPASS="<reason>". It is never silent —
// the reason is required, it is echoed on every allowed call, and the session
// is reported as UNGOVERNED. An undocumented or silent bypass would be worse
// than no guard, because it would make an ungoverned session look governed.
//
// This guard reads only. It never claims a workroom on the thread's behalf:
// claiming is a governed, attributable act that belongs to the thread.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { emitDeny, inDpfWorkspace, isShellTool, readHookPayload, shellCommandFromInput } from "./lib/hook-io.mjs";

const hooksDir = dirname(fileURLToPath(import.meta.url));

export const FILE_WRITE_TOOL_NAMES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Positive claims are cached briefly; a DENIAL is never cached, so a fix takes effect at once. */
const CACHE_TTL_MS = 60_000;

/**
 * Shell commands that can modify the working tree.
 *
 * Deliberately pattern-based rather than an allowlist of readers: a missed
 * reader costs one unnecessary check, a missed writer defeats the guard.
 */
const MUTATING_SHELL = [
  /(^|[;&|]\s*)(rm|mv|cp|mkdir|touch|truncate|install|ln)\s/,
  /(^|[;&|]\s*)(tee)\s/,
  /\bsed\s+(-[^\s]*\s+)*-i\b/,
  /\bperl\s+(-[^\s]*\s+)*-i\b/,
  /(^|[;&|]\s*)git\s+(add|commit|apply|checkout|switch|restore|reset|rebase|merge|revert|clean|stash|rm|mv|worktree)\b/,
  /(^|[;&|]\s*)(npm|pnpm|yarn)\s+(install|add|remove|link)\b/,
  /(^|[;&|]\s*)(patch|dd)\s/,
  />>?\s*[^\s&|]/,          // output redirection to a file
  /<<-?\s*['"]?[A-Za-z_]/,  // heredoc (how a shell-routed file write is usually shaped)
];

/** Commands that REPAIR conformance must never be blocked by the thing they repair. */
const REMEDIATION_SHELL = [
  /dpf-bootstrap-agent-toolchain\.(sh|ps1)/,
  /seed-worktree-mcp\.(sh|ps1)/,
  /sync-mcp-worktrees\.(sh|ps1)/,
  /git\s+worktree\s+add/,
];

export function shellMutatesTree(command) {
  if (!command || typeof command !== "string") return false;
  if (REMEDIATION_SHELL.some((re) => re.test(command))) return false;
  return MUTATING_SHELL.some((re) => re.test(command));
}

/** Does this call intend to change the tree? */
export function isMutatingCall({ toolName, toolInput }) {
  if (FILE_WRITE_TOOL_NAMES.has(toolName)) return true;
  if (isShellTool(toolName)) return shellMutatesTree(shellCommandFromInput(toolInput));
  return false;
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

function cachePath(worktree) {
  const dir = join(tmpdir(), "dpf-workroom-claim");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* fall through — a cache miss is always safe */
  }
  return join(dir, `${createHash("sha256").update(worktree).digest("hex").slice(0, 32)}.json`);
}

function readCache(worktree) {
  try {
    const raw = JSON.parse(readFileSync(cachePath(worktree), "utf8"));
    if (Date.now() - raw.at < CACHE_TTL_MS && raw.claimed === true) return raw;
  } catch {
    /* no usable cache */
  }
  return null;
}

function writeCache(worktree, capsuleId) {
  try {
    writeFileSync(cachePath(worktree), JSON.stringify({ at: Date.now(), claimed: true, capsuleId }));
  } catch {
    /* caching is an optimisation, never a correctness requirement */
  }
}

function bypassReason(env) {
  const raw = (env.DPF_WORKROOM_BYPASS || "").trim();
  return raw.length > 0 ? raw : null;
}

function denialText({ worktree, branch, step }) {
  return [
    "BLOCKED — no live Workroom claims this worktree.",
    "",
    `  worktree : ${worktree}`,
    `  branch   : ${branch || "(unknown)"}`,
    `  reason   : ${step?.detail || "workroom state could not be established"}`,
    "",
    "AGENTS.md §12: claim a Workroom before you work. Claim it with:",
    "",
    `  claim_backlog_item_for_work(itemId="<BI-…>", worktreePath="${worktree}",`,
    `                              branchName="${branch}", provider="claude", sessionRef="<session-id>")`,
    "",
    "No BI yet? File one first with create_backlog_item, then claim it.",
    "",
    'Genuinely blocked (portal down, emergency)? Set DPF_WORKROOM_BYPASS="<reason>".',
    "The reason is required and the session is then reported as UNGOVERNED.",
  ].join("\n");
}

async function main() {
  if (process.env.DPF_SKIP_WORKROOM_CLAIM_GUARD === "1") process.exit(0);

  const payload = readHookPayload();
  if (!payload) process.exit(0); // unparseable payload: fail open at the boundary

  const cwd = process.cwd();
  if (!inDpfWorkspace(cwd)) process.exit(0);
  if (!isMutatingCall(payload)) process.exit(0);

  const worktree = (git(["rev-parse", "--show-toplevel"], cwd) || cwd).replace(/\\/g, "/");
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);

  const bypass = bypassReason(process.env);
  if (bypass) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext:
            `UNGOVERNED — workroom claim bypassed. Reason: ${bypass}. ` +
            `This session is not tracked in the coordination plane; ${worktree} holds no live claim.`,
        },
      }),
    );
    process.exit(0);
  }

  if (readCache(worktree)) process.exit(0);

  const mod = await import(pathToFileURL(join(hooksDir, "lib/thread-conformance.mjs")).href);
  const result = await mod.evaluateThreadConformance({ cwd });
  const step = result.steps.find((s) => s.key === "workroom");

  if (step?.status === "pass") {
    writeCache(worktree, step.detail);
    process.exit(0);
  }

  emitDeny(denialText({ worktree, branch, step }));
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("workroom-claim-guard.mjs")) {
  main().catch(() => process.exit(0));
}
