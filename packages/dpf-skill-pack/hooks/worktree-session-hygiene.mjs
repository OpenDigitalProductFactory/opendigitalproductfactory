#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/worktree-session-hygiene.mjs
//
// Session-lifecycle worktree hygiene (operator concern: transactional, not cron).
//
// SessionStart — OBSERVE: report worktree count / non-canonical cwd; never delete.
// SessionEnd / Stop — TRANSACTIONAL REAP of THIS session's worktree only when it
//   is Tier A (merged + clean + no open PR + not pinned). Fail-open always.
//
// Why not cron-first: client CLIs do not run fleets of crons; portal Inngest may
// not see host worktrees; schedules get disabled or go dark. Session hooks fire
// wherever dpf-platform is installed (Claude plugin, Grok global plane, Codex
// hooks). The optional daily schedule remains a fleet backstop only.
//
// Escape hatches:
//   DPF_SKIP_WORKTREE_SESSION_HYGIENE=1  — no-op
//   DPF_WORKTREE_SESSION_REAP=0          — observe only on SessionEnd (no remove)
//   .worktree-pinned                     — never remove

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import { inDpfWorkspace } from "./lib/hook-io.mjs";

// Core lives in scripts/lib — resolve from repo root via skill-pack location.
const hooksDir = dirname(fileURLToPath(import.meta.url));
const skillPackRoot = resolve(hooksDir, "..");
const repoRootGuess = resolve(skillPackRoot, "../..");

function loadClassify() {
  const candidates = [
    join(repoRootGuess, "scripts/lib/worktree-janitor-core.mjs"),
    join(skillPackRoot, "../../scripts/lib/worktree-janitor-core.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return import(pathToFileURL(p).href);
    }
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
  return {
    ok: r.status === 0,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
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
  return "SessionEnd";
}

function sessionCwd(payload) {
  return (
    payload.cwd ||
    payload.workspaceRoot ||
    payload.workspace_root ||
    process.cwd()
  );
}

function resolveGitRoot(cwd) {
  const r = runGit(["rev-parse", "--show-toplevel"], cwd);
  return r.ok ? r.stdout : null;
}

function resolveCommonRoot(cwd) {
  const r = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (!r.ok || !r.stdout) return resolveGitRoot(cwd);
  // git-common-dir is .../.git — parent is main worktree root
  const common = r.stdout.replace(/[/\\]\.git$/, "");
  return common || resolveGitRoot(cwd);
}

function countWorktrees(root) {
  const r = runGit(["worktree", "list", "--porcelain"], root);
  if (!r.ok) return 0;
  return r.stdout.split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length;
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

function gatherThisWorktreeFacts(cwd, mainRoot) {
  const wtPath = resolve(cwd);
  const branchR = runGit(["branch", "--show-current"], wtPath);
  const branch = branchR.ok && branchR.stdout ? branchR.stdout : null;
  const dirtyR = runGit(["status", "--porcelain"], wtPath);
  const dirty = dirtyR.ok && dirtyR.stdout.length > 0;
  let merged = false;
  if (branch) {
    const anc = runGit(
      ["merge-base", "--is-ancestor", `refs/heads/${branch}`, "origin/main"],
      mainRoot,
    );
    if (anc.ok) merged = true;
    else {
      const gh = spawnSync(
        "gh",
        ["pr", "list", "--head", branch, "--state", "merged", "--json", "number", "--jq", "length"],
        { encoding: "utf8", windowsHide: true, timeout: 20_000 },
      );
      if (gh.status === 0 && Number((gh.stdout || "0").trim()) > 0) merged = true;
    }
  }
  let hasOpenPr = false;
  if (branch) {
    const gh = spawnSync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "--jq", "length"],
      { encoding: "utf8", windowsHide: true, timeout: 20_000 },
    );
    hasOpenPr = gh.status === 0 && Number((gh.stdout || "0").trim()) > 0;
  }
  const ageR = runGit(["log", "-1", "--format=%ct"], wtPath);
  let ageDays = 0;
  if (ageR.ok && ageR.stdout) {
    const ts = Number(ageR.stdout);
    if (Number.isFinite(ts) && ts > 0) ageDays = Math.floor((Date.now() / 1000 - ts) / 86400);
  }
  return {
    path: wtPath,
    branch,
    isRoot: resolve(wtPath) === resolve(mainRoot),
    pinned: existsSync(join(wtPath, ".worktree-pinned")),
    hasActiveLease: false, // lease released by session-reaper; do not block on MCP here
    hasOpenPr,
    merged,
    dirty,
    ageDays,
  };
}

function removeThisWorktree(mainRoot, wtPath) {
  const helper = join(repoRootGuess, "scripts/lib/junction-safe-worktree-remove.mjs");
  if (!existsSync(helper)) {
    return { ok: false, detail: "junction-safe helper missing" };
  }
  const r = spawnSync(process.execPath, [helper, mainRoot, wtPath, "--force"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  });
  return {
    ok: r.status === 0,
    detail: (r.stdout || r.stderr || "").trim().slice(0, 400),
  };
}

function emitContext(hookEventName, text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        additionalContext: text,
      },
    }),
  );
}

async function main() {
  if (process.env.DPF_SKIP_WORKTREE_SESSION_HYGIENE === "1") process.exit(0);

  const payload = readPayload();
  const event = hookEventName(payload);
  const cwd = sessionCwd(payload);

  if (!inDpfWorkspace(cwd)) process.exit(0);

  const mainRoot = resolveCommonRoot(cwd) || resolveGitRoot(cwd);
  if (!mainRoot) process.exit(0);

  const core = await loadClassify();
  if (!core?.classifyWorktree) process.exit(0);
  const { classifyWorktree } = core;

  if (event === "SessionStart") {
    const n = countWorktrees(mainRoot);
    const facts = gatherThisWorktreeFacts(cwd, mainRoot);
    const lines = [];
    if (n >= 20) {
      lines.push(
        `Worktree hygiene: ${n} registered worktrees on this clone (target is a bounded count). ` +
          `Tier-A (merged+clean) worktrees are reaped on SessionEnd of that worktree; ` +
          `fleet backstop: node scripts/worktree-janitor.mjs --dry-run --tier-a-only.`,
      );
    }
    if (!facts.isRoot && !isCanonicalSibling(facts.path, mainRoot)) {
      lines.push(
        `Worktree hygiene: cwd is non-canonical (${facts.path}). Prefer D:/DPF-worktrees/<topic> (or ~/dpf-worktrees/<topic>). Nested .claude/worktrees is not the DPF convention.`,
      );
    }
    if (facts.branch && facts.merged && !facts.dirty) {
      lines.push(
        `Worktree hygiene: branch ${facts.branch} is already merged and clean — this worktree is Tier-A and will be reaped on SessionEnd unless pinned or DPF_WORKTREE_SESSION_REAP=0.`,
      );
    }
    if (lines.length) emitContext("SessionStart", lines.join("\n"));
    process.exit(0);
  }

  // SessionEnd / Stop — transactional reap of THIS worktree only.
  const facts = gatherThisWorktreeFacts(cwd, mainRoot);
  if (facts.isRoot) process.exit(0);

  const { verdict, reason } = classifyWorktree(facts);
  const allowReap = process.env.DPF_WORKTREE_SESSION_REAP !== "0";

  if (verdict !== "PRUNE_TIER_A") {
    if (verdict === "PRUNE_TIER_B" || (facts.dirty && facts.merged)) {
      emitContext(
        event,
        `Worktree hygiene: leaving ${facts.path} in place (${reason}). ` +
          `Not auto-removed (Tier-A only on SessionEnd).`,
      );
    }
    process.exit(0);
  }

  if (!allowReap) {
    emitContext(
      event,
      `Worktree hygiene: Tier-A candidate ${facts.path} (${reason}) — not removed because DPF_WORKTREE_SESSION_REAP=0.`,
    );
    process.exit(0);
  }

  const rem = removeThisWorktree(mainRoot, facts.path);
  if (rem.ok && facts.branch) {
    runGit(["branch", "-D", facts.branch], mainRoot);
  }
  emitContext(
    event,
    rem.ok
      ? `Worktree hygiene: reaped Tier-A worktree ${facts.path} (branch ${facts.branch}). ${rem.detail}`
      : `Worktree hygiene: Tier-A reap failed for ${facts.path}: ${rem.detail}`,
  );
  process.exit(0);
}

main().catch(() => process.exit(0));
