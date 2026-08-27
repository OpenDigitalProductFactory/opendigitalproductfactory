#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/workroom-claim-guard.mjs
//
// PreToolUse guard (BI-0B292D84): work on a feature branch must be covered by a
// live Workroom claim.
//
// AGENTS.md §12 says "Claim a workroom before you work — every surface,
// including the external CLIs." Every other §12 rule that says "hook-refused"
// has a hook; this one had none, so it was prose. Measured 2026-08-26 on this
// install: 30 of 79 live worktree branches had no WorkCapsule binding, and 10
// of 17 workrooms in status `working` had neither a headBranch nor a
// worktreePath. An agent that never claimed looked exactly like one that did.
//
// HOW IT DECIDES
//   Every existing guard here (lease, root-clone, compose) is a fast local
//   pattern-matcher — none makes a network call, because PreToolUse runs before
//   every edit. This guard keeps that property: it reads a claim marker cached
//   beside the repo's shared git dir. The marker is a CACHE OF AN MCP ANSWER —
//   it carries the capsule's own lease expiry and its branch, so it cannot
//   outlive the claim it records and cannot be reused on another branch. MCP
//   remains the only authority.
//
// ROLLOUT — READ THIS BEFORE CHANGING THE DEFAULT
//   The deny path is complete and tested, but it is OFF by default and the
//   guard emits advisory context instead. That is deliberate, not timidity:
//   nothing yet writes the marker automatically. Layer 1 of BI-0B292D84
//   (bind-at-birth in worktree-create.mjs) is what makes compliance automatic,
//   and until it lands, denying by default would refuse every agent for a
//   condition they cannot yet satisfy without a manual step. Flip the default
//   to deny in the same change that lands bind-at-birth.
//   Enforce today with DPF_WORKROOM_CLAIM_ENFORCE=1.
//
// Fails OPEN on any IO/parse error, like every guard here — but an
// unavailable guard is REPORTED, never silent, because a gate that is off and
// looks identical to a gate that passed is the exact defect this closes.
//
// Emergency bypass: prefix the command with DPF_ALLOW_UNCLAIMED_WORK=1.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readHookPayload, isShellTool, emitDeny, emitContext, inDpfWorkspace, shellCommandFromInput } from "./lib/hook-io.mjs";
import {
  CLAIM_MARKER_NAME,
  NUDGE_STAMP_NAME,
  classifyClaim,
  denyGuidance,
  parseClaimMarker,
  shouldNudge,
} from "./lib/workroom-claim-lookup.mjs";

const GIT_TIMEOUT_MS = 3_000;

/** Tools that mutate the working tree and therefore constitute "work". */
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Shell commands that record work. Reading, branching and status do not. */
export function isWorkCommand(command) {
  if (typeof command !== "string" || command === "") return false;
  return /\bgit\s+(commit|cherry-pick|revert|merge|rebase)\b/.test(command);
}

/** Does this invocation constitute work on the tree? */
export function isWorkInvocation(toolName, toolInput) {
  if (EDIT_TOOLS.has(toolName)) return true;
  if (isShellTool(toolName)) return isWorkCommand(shellCommandFromInput(toolInput));
  return false;
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Current branch, or null on detached HEAD / not a repo. */
function currentBranch(cwd) {
  const ref = git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return ref || null;
}

/** Absolute path of THIS worktree's private git dir, or null. */
function worktreeGitDir(cwd) {
  return git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]);
}

/**
 * Read the nudge stamp: when this worktree was last told it has no claim, and
 * for which branch. Unreadable reads as "never nudged" — an extra advisory is
 * cheap, a suppressed one is the bug.
 */
function readNudgeStamp(gitDir) {
  if (!gitDir) return { stampMs: null, stampBranch: null };
  try {
    const raw = JSON.parse(readFileSync(path.join(gitDir, NUDGE_STAMP_NAME), "utf8"));
    const at = typeof raw?.at === "string" ? Date.parse(raw.at) : NaN;
    return {
      stampMs: Number.isFinite(at) ? at : null,
      stampBranch: typeof raw?.branch === "string" ? raw.branch : null,
    };
  } catch {
    return { stampMs: null, stampBranch: null };
  }
}

function writeNudgeStamp(gitDir, branch, nowIso) {
  if (!gitDir) return;
  try {
    writeFileSync(path.join(gitDir, NUDGE_STAMP_NAME), JSON.stringify({ branch, at: nowIso }), "utf8");
  } catch {
    /* best-effort: an unwritable stamp just means we nudge again next time */
  }
}

function readMarker(cwd) {
  // --git-dir, NOT --git-common-dir. The common dir is SHARED by every worktree
  // of the repo (D:/repo/.git), so a marker written there would be read by all
  // of them and only one branch could ever hold a claim across the whole
  // estate. --git-dir is per-worktree (D:/repo/.git/worktrees/<name>), which is
  // the right scope: one claim per working tree, exactly matching
  // "one thread = one branch + one worktree". In the root clone the two paths
  // coincide, which is harmless — the root sits on main and main is exempt.
  const gitDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (!gitDir) return { marker: null, lookupFailed: true };
  try {
    return { marker: parseClaimMarker(readFileSync(path.join(gitDir, CLAIM_MARKER_NAME), "utf8")), lookupFailed: false };
  } catch (err) {
    // ENOENT is a real answer: no claim was ever recorded here. Anything else
    // (permissions, IO) is us being unable to tell, which is not the same thing.
    if (err && err.code === "ENOENT") return { marker: null, lookupFailed: false };
    return { marker: null, lookupFailed: true };
  }
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open on read/parse error
  if (!inDpfWorkspace(payload.cwd)) process.exit(0);
  if (process.env.DPF_ALLOW_UNCLAIMED_WORK === "1") process.exit(0);
  // readHookPayload NORMALIZES to camelCase (hook-io.mjs normalizePayload):
  // toolName/toolInput, never tool_name/tool_input. Reading the snake_case
  // names yields undefined, isWorkInvocation returns false, and the guard
  // silently allows everything while still exiting 0 -- indistinguishable
  // from a guard that ran and was satisfied. That is the very defect this
  // guard exists to close, so it is covered by a functional test that pipes a
  // real payload through the binary, not just unit tests of the pure helpers.
  if (!isWorkInvocation(payload.toolName, payload.toolInput)) process.exit(0);

  const cwd = payload.cwd || process.cwd();
  const branch = currentBranch(cwd);
  const { marker, lookupFailed } = readMarker(cwd);
  const verdict = classifyClaim({ branch, marker, nowMs: Date.now(), lookupFailed });

  if (verdict.kind === "allow") process.exit(0);

  if (verdict.kind === "fail-open") {
    // Attest rather than pass silently: "the guard could not run" must never
    // read the same as "the guard was satisfied" (BI-3727106F, same defect class).
    emitContext(
      `[workroom-claim-guard] could not determine whether branch "${verdict.branch}" is covered by a Workroom claim, so it allowed this edit. ` +
        `Treat this as an UNVERIFIED claim, not a satisfied one: confirm with get_workroom, or call adopt_worktree if you have not claimed a Workroom for this branch.`,
    );
    process.exit(0);
  }

  const guidance = denyGuidance(verdict);

  // A refusal is NEVER throttled: a gate that declines to refuse because it
  // refused recently is not a gate.
  if (process.env.DPF_WORKROOM_CLAIM_ENFORCE === "1") emitDeny(guidance);

  // The advisory IS throttled. This guard fires on every edit to any file on an
  // unclaimed branch, so repeating a 700-character message per edit would bury
  // the agent's context in text it has already read — and make this the guard
  // people switch off.
  const now = new Date();
  const gitDir = worktreeGitDir(cwd);
  const { stampMs, stampBranch } = readNudgeStamp(gitDir);
  if (shouldNudge({ stampMs, stampBranch, branch: verdict.branch, nowMs: now.getTime() })) {
    writeNudgeStamp(gitDir, verdict.branch, now.toISOString());
    emitContext(`[workroom-claim-guard] ${guidance} (advisory until bind-at-birth lands — set DPF_WORKROOM_CLAIM_ENFORCE=1 to refuse instead)`);
  }
  process.exit(0);
}

// fileURLToPath, never `new URL(...).pathname` (BI-5CBDC146: the pathname is
// "/D:/..." on Windows and every path built from it is unopenable).
const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    main();
  } catch {
    process.exit(0); // a guard must never wedge the session
  }
}
