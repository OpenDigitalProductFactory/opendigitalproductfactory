#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/worktree-session-heartbeat.mjs
//
// Worktree session heartbeat (EP-PROCESS-SPINE, plan 2026-08-11-worktree-lifecycle-hygiene).
//
// Writes/refreshes a GITIGNORED liveness marker in THIS session's worktree so the
// fleet worktree janitor never reaps a worktree out from under a live session (the
// "janitor reaped an active session's worktree mid-session" near-miss).
//
//   SessionStart, Stop  → write/refresh the marker (Stop fires every turn, so the
//                         marker stays fresh throughout a live session).
//   SessionEnd          → remove the marker (the session is over; the worktree is
//                         now eligible for its normal Tier-A reap).
//
// This hook is NON-DESTRUCTIVE by construction — it only ever writes or deletes a
// single marker file. That is exactly why it is safe on `Stop` (a per-turn event),
// unlike worktree-session-hygiene.mjs, whose destructive reap is confined to
// SessionEnd (BI-E5D810B8). Keep the two concerns separate: never add reaping here.
//
// Fail-open always. Skips the root/main clone (never reaped) and anything outside a
// DPF workspace. Escape hatch: DPF_SKIP_WORKTREE_SESSION_HEARTBEAT=1.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inDpfWorkspace } from "./lib/hook-io.mjs";

const hooksDir = dirname(fileURLToPath(import.meta.url));
const skillPackRoot = resolve(hooksDir, "..");
const repoRootGuess = resolve(skillPackRoot, "../..");

function loadHeartbeatLib() {
  const candidates = [
    join(repoRootGuess, "scripts/lib/worktree-session-heartbeat.mjs"),
    join(skillPackRoot, "../../scripts/lib/worktree-session-heartbeat.mjs"),
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

function hookEventName(payload) {
  const n = payload.hookEventName ?? payload.hook_event_name ?? "";
  if (/sessionstart/i.test(n) || n === "SessionStart") return "SessionStart";
  if (/^stop$/i.test(n) || n === "Stop") return "Stop";
  if (/sessionend/i.test(n) || n === "SessionEnd") return "SessionEnd";
  // Unknown → treat as a refresh (write), never as a remove, so a mislabeled
  // event can only KEEP a worktree alive, never strand a live one.
  return "Stop";
}

function sessionCwd(payload) {
  return payload.cwd || payload.workspaceRoot || payload.workspace_root || process.cwd();
}

/** The worktree toplevel to heartbeat, or null when this is the root/main clone. */
function resolveLinkedWorktreeTop(cwd) {
  const top = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!top.ok || !top.stdout) return null;
  const common = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (!common.ok || !common.stdout) return null;
  const commonRoot = common.stdout.replace(/[/\\]\.git$/, "");
  // Linked worktree ⇔ its git-common-dir parent differs from its own toplevel.
  if (resolve(commonRoot) === resolve(top.stdout)) return null; // root/main clone — skip
  return top.stdout;
}

function sessionIdOf(payload) {
  const id = payload.sessionId ?? payload.session_id ?? payload.transcriptSessionId;
  return typeof id === "string" && id ? id : undefined;
}

async function main() {
  if (process.env.DPF_SKIP_WORKTREE_SESSION_HEARTBEAT === "1") process.exit(0);

  const payload = readPayload();
  const cwd = sessionCwd(payload);
  if (!inDpfWorkspace(cwd)) process.exit(0);

  const top = resolveLinkedWorktreeTop(cwd);
  if (!top) process.exit(0); // not a linked worktree (root clone or non-git) — nothing to heartbeat

  const lib = await loadHeartbeatLib();
  if (!lib?.writeHeartbeat) process.exit(0);

  const event = hookEventName(payload);
  if (event === "SessionEnd") {
    lib.removeHeartbeat(top);
  } else {
    lib.writeHeartbeat(top, { sessionId: sessionIdOf(payload), event });
  }
  process.exit(0);
}

// Run only when invoked directly (not when imported by the test).
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("worktree-session-heartbeat.mjs")) {
  main().catch(() => process.exit(0));
}
