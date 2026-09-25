#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/uncommitted-work-guard.mjs
//
// Process-spine P0 guard (BI-38578194, spec §6.3): warn before durable-artifact
// loss on branch switch or session end. Scans tracked-but-uncommitted and
// untracked files. Non-blocking — emits a warning and always exits 0.
// Escape hatch: DPF_SKIP_UNCOMMITTED_WORK_GUARD=1.
//
// Modes:
//   --snapshot   SessionStart: record what is already dirty, per session.
//   --git-hook   post-checkout: warn on stderr, no session state.
//   (default)    Stop / SessionEnd: warn about work that is new or changed
//                since the snapshot, at most once per distinct set.

import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  attributeWork,
  buildAttributedWarning,
  buildUnattributedWarning,
  findLosableWork,
  subtractBaseline,
  warnedSetSignature,
} from "./uncommitted-work-scan.mjs";

const STATE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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

function readPayload() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    // stdin optional for direct invocation
    return {};
  }
}

function sessionIdOf(payload) {
  const id = payload?.session_id ?? payload?.sessionId;
  if (typeof id !== "string" || id.trim() === "") return null;
  return id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}

// BI-F4BE47B5: Claude Code registers this guard twice in a DPF checkout — from
// the checkout's .claude/settings.json and from the dpf-platform plugin. The
// plugin copy runs from ~/.claude/plugins/cache, which every checkout shares
// and which holds whatever tree last ran `claude plugin install`; on 2026-09-24
// that was a tree from before #5568 and #5592, so it warned on every Stop and
// every re-entry. When the project registers its own copy, that copy matches
// the checkout, so any other copy stands down. Codex and Grok set no
// CLAUDE_PROJECT_DIR and keep running the plugin copy.
const PROJECT_COPY = join("packages", "dpf-skill-pack", "hooks", "uncommitted-work-guard.mjs");

function realOrNull(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

export function yieldsToProjectCopy(env = process.env, self = fileURLToPath(import.meta.url)) {
  const projectDir = env.CLAUDE_PROJECT_DIR;
  if (!projectDir) return false;
  const projectCopy = realOrNull(join(projectDir, PROJECT_COPY));
  if (!projectCopy || projectCopy === realOrNull(self)) return false;
  try {
    const settings = readFileSync(join(projectDir, ".claude", "settings.json"), "utf8");
    return settings.includes(PROJECT_COPY.replace(/\\/g, "/"));
  } catch {
    return false;
  }
}

// Per-repository, per-session state under the git common dir: never tracked,
// shared by every worktree of the clone, gone with the clone.
function stateRoot(baseDir) {
  const r = spawnSync("git", ["-C", baseDir, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  const common = r.stdout.trim();
  const abs = isAbsolute(common) ? common : resolve(baseDir, common);
  return join(abs, "dpf-hook-state", "uncommitted-work-guard");
}

function sessionDir(baseDir, sessionId) {
  if (!sessionId) return null;
  const root = stateRoot(baseDir);
  return root ? join(root, sessionId) : null;
}

// Cheap change detector: status code, size and mtime. Enough to tell "the
// same dirty file nobody has touched" from "the session edited it".
function fingerprint(baseDir, hit) {
  try {
    const st = lstatSync(join(baseDir, hit.path));
    return `${hit.xy}|${st.size}|${st.mtimeMs}`;
  } catch {
    return `${hit.xy}|absent`;
  }
}

function scan(baseDir) {
  return findLosableWork(gitPorcelain(baseDir)).map((hit) => ({
    ...hit,
    fingerprint: fingerprint(baseDir, hit),
  }));
}

function pruneStale(root, now = Date.now()) {
  try {
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (now - statSync(dir).mtimeMs > STATE_TTL_MS) rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // best effort
  }
}

function writeSnapshot(baseDir, sessionId) {
  const dir = sessionDir(baseDir, sessionId);
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  pruneStale(join(dir, ".."));
  const baseline = Object.fromEntries(scan(baseDir).map((h) => [h.path, h.fingerprint]));
  try {
    // First writer wins: the guard may be wired from more than one hooks file,
    // and a resumed session must keep its original baseline.
    writeFileSync(join(dir, "baseline.json"), JSON.stringify(baseline), { flag: "wx" });
  } catch {
    // already recorded
  }
}

function readBaseline(dir) {
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8"));
  } catch {
    return null;
  }
}

// True exactly once per session for a given dirty set (paths + status codes).
// An exclusive create makes this race-free when two hooks files both run it.
function claimFirstWarning(dir, hits) {
  if (!dir) return true;
  const sig = createHash("sha256").update(warnedSetSignature(hits)).digest("hex").slice(0, 32);
  try {
    mkdirSync(dir, { recursive: true });
    closeSync(openSync(join(dir, `warned-${sig}`), "wx"));
    return true;
  } catch (err) {
    return err?.code !== "EEXIST";
  }
}

// Stop accepts `hookSpecificOutput.additionalContext`; SessionEnd does not —
// Claude Code rejects it ("Hook JSON output validation failed"). SessionEnd
// cannot reach the model anyway, so it tells the operator via `systemMessage`.
function claudeHookOutput(warning, hookEventName) {
  if (hookEventName === "Stop") {
    return { hookSpecificOutput: { hookEventName, additionalContext: warning } };
  }
  return { systemMessage: warning };
}

function emitClaudeWarning(warning, hookEventName) {
  process.stdout.write(JSON.stringify(claudeHookOutput(warning, hookEventName)));
}

function main() {
  if (skipGuard()) process.exit(0);

  const argv = process.argv.slice(2);
  const isGitHook = argv.includes("--git-hook");
  if (!isGitHook && yieldsToProjectCopy()) process.exit(0);
  const isSnapshot = argv.includes("--snapshot");
  const rootArgIdx = argv.indexOf("--repo-root");
  const baseDir = repoRoot(rootArgIdx >= 0 ? argv[rootArgIdx + 1] : null);

  const payload = isGitHook ? {} : readPayload();
  const sessionId = sessionIdOf(payload);

  if (isSnapshot) {
    try {
      writeSnapshot(baseDir, sessionId);
    } catch {
      // a guard must never break session start
    }
    process.exit(0);
  }

  // BI-910C37B1: every losable modification, not only spec/plan paths. The
  // 2026-08-21 loss was source edits this guard never mentioned.
  const context = isGitHook ? "post-checkout" : "session-end";
  let losable = isGitHook ? findLosableWork(gitPorcelain(baseDir)) : scan(baseDir);

  let dir = null;
  if (!isGitHook) {
    // Work that was already dirty when the session started, and is still in
    // exactly that state, is not this session's to report — it was listed to
    // whoever made it. Only what appeared or changed since then counts.
    dir = sessionDir(baseDir, sessionId);
    losable = subtractBaseline(losable, readBaseline(dir));
  }
  if (losable.length === 0) process.exit(0);

  // Attribution: a hook cannot see which files THIS session wrote, so it must
  // not claim ownership either way. When a caller supplies the touched set
  // (newline- or colon-separated paths), the message splits by author; without
  // it, the message says plainly that some of this may be another session's —
  // because advising "stash it" over someone else's in-flight work is how the
  // guard turns into the thing it exists to prevent.
  const touched = String(process.env.DPF_SESSION_TOUCHED_PATHS ?? "")
    .split(/[\n:]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const warning = touched.length > 0
    ? buildAttributedWarning(attributeWork(losable, touched), { context })
    : buildUnattributedWarning(losable, { context });

  if (isGitHook) {
    process.stderr.write(`\n${warning}\n\n`);
    process.exit(0);
  }

  const hookEventName =
    payload?.hook_event_name === "Stop" || payload?.hookEventName === "Stop" ? "Stop" : "SessionEnd";
  const stopHookActive = payload?.stop_hook_active === true || payload?.stopHookActive === true;

  // A Stop hook that returns context re-prompts the model, and the model's
  // reply ends the turn again — which runs this hook again. Claude Code marks
  // that second pass with `stop_hook_active`; answering it with more context
  // is an unbounded loop the harness only cuts at its block cap ("A hook
  // blocked the turn from ending 9 consecutive times").
  if (stopHookActive) process.exit(0);

  // `stop_hook_active` resets every turn, and some hosts (the desktop Code tab,
  // 2026-09-25) never set it at all, so it alone still repeated the same list
  // at the end of every turn. Say each distinct set once per session, keyed on
  // paths and status codes — not mtimes, which a regenerator such as the
  // bootstrap's `.mcp.json` write changes without changing the set. A new
  // path, or a path whose status changes, is a new set and is reported.
  if (!claimFirstWarning(dir, losable)) process.exit(0);

  emitClaudeWarning(warning, hookEventName);
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("uncommitted-work-guard.mjs")) {
  main();
}