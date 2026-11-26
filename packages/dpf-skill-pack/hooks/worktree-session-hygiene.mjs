#!/usr/bin/env node
// BI-F52EF21B: SessionStart observes. SessionEnd audits a refusal, never reaps.
// A provider lifecycle event only names the session's own cwd and says nothing
// about host-thread or Workroom liveness. T3 can send it between turns. The
// governed worktree janitor owns removal; this hook has no removal/restore path.

import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import { inDpfWorkspace } from "./lib/hook-io.mjs";

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8")) ?? {};
  } catch {
    return {};
  }
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 5_000 });
  return r.status === 0 ? r.stdout.trim() : "";
}

function isCanonicalSibling(wtPath, mainRoot) {
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  const wt = norm(wtPath);
  const main = norm(mainRoot);
  // Nested .claude/worktrees is non-canonical
  if (wt.includes("/.claude/worktrees/") || wt.includes("/.claude/worktrees")) return false;
  // Sibling * -worktrees / DPF-worktrees
  if (/[/]dpf-worktrees[/]/i.test(wt) || /[/][^/]+-worktrees[/]/i.test(wt)) return true;
  // Older alongside form D:/DPF-topic
  if (wt !== main && /[/]DPF-[^/]+$/i.test(wt)) return true;
  // Inside main tree but not nested claude — still non-ideal
  if (wt.startsWith(main + "/")) return false;
  return true;
}

function auditRefusal(cwd, commonDir, top) {
  const branch = top ? git(["branch", "--show-current"], top) || null : null;
  const reason = process.env.T3CODE_THREAD_ID
    ? "T3 provider exit is not thread settlement"
    : "SessionEnd names the session cwd, not an authorized cleanup target";
  const line = JSON.stringify({
    at: new Date().toISOString(),
    path: top || resolve(cwd),
    branch,
    tier: null,
    reason,
    outcome: "refused",
  }) + "\n";
  try {
    if (!commonDir) throw new Error("common Git directory unavailable");
    appendFileSync(join(commonDir, "dpf-worktree-reap.jsonl"), line, { mode: 0o600 });
  } catch {
    // A broken checkout or unwritable log must not make the refusal silent.
    process.stderr.write(line);
  }
}

function main() {
  const payload = readPayload();
  const name = String(payload.hookEventName ?? payload.hook_event_name ?? "").toLowerCase();
  if (name !== "sessionstart" && name !== "sessionend") return;
  const cwd = payload.cwd || payload.workspaceRoot || payload.workspace_root || process.cwd();
  if (typeof cwd !== "string" || !inDpfWorkspace(cwd)) return;
  if (name === "sessionstart" && process.env.DPF_SKIP_WORKTREE_SESSION_HYGIENE === "1") return;

  const top = git(["rev-parse", "--show-toplevel"], cwd);
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (name === "sessionend") {
    auditRefusal(cwd, commonDir, top);
    return;
  }
  if (!top || !commonDir) return;

  const mainRoot = dirname(commonDir);
  const n = git(["worktree", "list", "--porcelain"], top)
    .split(/\r?\n/).filter((line) => line.startsWith("worktree ")).length;
  const lines = [];
  if (n >= 20) {
    lines.push(
      `Worktree hygiene: ${n} registered worktrees on this clone. ` +
      "The platform's ops/worktree-janitor job owns cleanup. " +
      "Preview: node scripts/worktree-janitor.mjs --dry-run --tier-a-only.",
    );
  }
  if (resolve(top) !== resolve(mainRoot) && !isCanonicalSibling(top, mainRoot)) {
    lines.push(`Worktree hygiene: cwd is non-canonical (${top}). Prefer the clone's dedicated sibling worktrees directory.`);
  }
  if (lines.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") },
    }));
  }
}

main();
