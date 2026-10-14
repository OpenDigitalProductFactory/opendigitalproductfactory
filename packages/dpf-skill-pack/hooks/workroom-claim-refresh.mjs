#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/workroom-claim-refresh.mjs
//
// PostToolUse (BI-AB4EA033): re-cache the Workroom claim marker from the MCP
// answer that just renewed or granted the claim.
//
// WHY
//   workroom-claim-guard.mjs allows work only while <git-dir>/dpf-workroom-claim.json
//   holds an unexpired lease. That expiry IS the Workroom lease (~30 min), and
//   only worktree creation, bind-worktree-cli and the reconcile script wrote the
//   file. heartbeat_workroom, adopt_worktree and the claim tools renewed the lease
//   over MCP and left the cached copy stale, so the guard refused edits on a claim
//   the agent had just renewed — and bind-worktree-cli could refuse to re-cache it
//   when the MCP claim carried a different sessionRef than the CLI sends.
//
// WHAT IT WRITES
//   The marker stays a CACHE OF AN MCP ANSWER, never a substitute for one: it is
//   built only from the tool's own response, and only when that answer names a
//   live capsule (non-terminal, lease in the future) whose headBranch is the
//   branch checked out at its worktreePath. Anything else is a no-op.
//
// Never denies, never prints, and exits 0 on every error: a refresh that cannot
// run leaves the guard's existing verdict, and its message names the manual path.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inDpfWorkspace, toNativePath } from "./lib/hook-io.mjs";
import { CLAIM_MARKER_NAME, isClaimExemptBranch } from "./lib/workroom-claim-lookup.mjs";

const GIT_TIMEOUT_MS = 3_000;

/** dpf MCP tools whose successful answer names the caller's live capsule. */
const CLAIM_TOOLS = ["adopt_worktree", "heartbeat_workroom", "claim_workroom_scope", "claim_backlog_item_for_work", "create_workroom"];
const CLAIM_TOOL_RE = new RegExp(`^mcp__.+__(${CLAIM_TOOLS.join("|")})$`);

const TERMINAL_STATUSES = new Set(["complete", "abandoned", "archived"]);

/** @param {unknown} toolName */
export function isClaimTool(toolName) {
  return typeof toolName === "string" && CLAIM_TOOL_RE.test(toolName);
}

function parseJsonObject(text) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null; // includes Claude Code's "Error: ..." text for a failed call
  }
}

function fromContentBlocks(blocks) {
  for (const block of blocks) {
    const parsed = block?.type === "text" ? parseJsonObject(block.text) : null;
    if (parsed) return parsed;
  }
  return null;
}

/**
 * The tool's JSON answer. Claude Code records an MCP result as its JSON text
 * (observed in session transcripts); the docs leave the hook shape open, so
 * content blocks and structuredContent are read too.
 * @param {unknown} response
 */
export function parseToolResponse(response) {
  if (typeof response === "string") return parseJsonObject(response);
  if (Array.isArray(response)) return fromContentBlocks(response);
  if (!response || typeof response !== "object") return null;
  if (response.structuredContent && typeof response.structuredContent === "object") return response.structuredContent;
  if (Array.isArray(response.content)) return fromContentBlocks(response.content);
  return response;
}

/**
 * The capsule a successful answer names, or null. heartbeat/adopt/claim_scope
 * answer {capsule}; claim_backlog_item_for_work carries the lease on {readback};
 * tool-result envelopes wrap it in {data}.
 * @param {any} answer
 */
export function capsuleFromAnswer(answer) {
  if (!answer || typeof answer !== "object") return null;
  if (answer.success === false || answer.error || answer.claimed === false) return null;
  for (const candidate of [answer.data?.capsule, answer.capsule, answer.readback, answer.data, answer]) {
    if (
      candidate &&
      typeof candidate.capsuleId === "string" &&
      typeof candidate.leaseExpiresAt === "string" &&
      Number.isFinite(Date.parse(candidate.leaseExpiresAt))
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Decide the marker for a capsule against the branch checked out at its
 * worktree. Returns { marker } or { skip: reason }. Pure.
 * @param {{ capsule: any, currentBranch: string|null, nowMs: number }} input
 */
export function planMarker({ capsule, currentBranch, nowMs }) {
  if (!capsule) return { skip: "no-capsule" };
  if (typeof capsule.worktreePath !== "string" || capsule.worktreePath === "") return { skip: "no-worktree" };
  if (typeof capsule.status === "string" && TERMINAL_STATUSES.has(capsule.status)) return { skip: "terminal-capsule" };
  if (!(Date.parse(capsule.leaseExpiresAt) > nowMs)) return { skip: "lease-expired" };
  if (!capsule.headBranch || capsule.headBranch !== currentBranch) return { skip: "branch-mismatch" };
  if (isClaimExemptBranch(currentBranch)) return { skip: "exempt-branch" };
  return {
    marker: {
      capsuleId: capsule.capsuleId,
      branch: currentBranch,
      leaseExpiresAt: capsule.leaseExpiresAt,
      worktreePath: capsule.worktreePath,
      backlogItemId: typeof capsule.backlogItemId === "string" ? capsule.backlogItemId : null,
    },
  };
}

function git(cwd, args) {
  try {
    return (
      execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

function main() {
  let raw;
  try {
    const text = readFileSync(0, "utf8");
    raw = text ? JSON.parse(text) : {};
  } catch {
    return;
  }
  const toolName = raw.tool_name ?? raw.toolName;
  if (!isClaimTool(toolName)) return;

  const capsule = capsuleFromAnswer(parseToolResponse(raw.tool_response ?? raw.toolResponse));
  if (!capsule || typeof capsule.worktreePath !== "string") return;

  // Follow the answer, not the session folder: on an install host the session
  // opens in the installed runtime while the claim is for a sibling worktree.
  const worktree = toNativePath(capsule.worktreePath);
  if (!existsSync(worktree) || !inDpfWorkspace(worktree)) return;

  const plan = planMarker({ capsule, currentBranch: git(worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"]), nowMs: Date.now() });
  if (!plan.marker) return;

  // --git-dir, not --git-common-dir: the marker is per worktree, as the guard reads it.
  const gitDir = git(worktree, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (!gitDir) return;
  writeFileSync(path.join(gitDir, CLAIM_MARKER_NAME), JSON.stringify(plan.marker), "utf8");
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    main();
  } catch {
    /* a refresh must never wedge the session */
  }
  process.exit(0);
}
