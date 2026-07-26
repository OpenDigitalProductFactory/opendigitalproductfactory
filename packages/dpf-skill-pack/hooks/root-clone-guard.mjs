#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/root-clone-guard.mjs
//
// PreToolUse guard (BI-3FAA13A7 — "stop the bleeding" pillar): refuse a
// recursive-force filesystem delete that would FOLLOW A JUNCTION/SYMLINK into,
// or DIRECTLY TARGET, the shared root clone (D:/DPF). This is the exact
// mechanism that wiped 730 tracked files under packages/* on 2026-06-19:
// worktrees nested inside the root (173 of 277 live worktrees sat at
// D:/DPF/.claude/worktrees/<name>) share the root via junctioned node_modules
// (<wt>/node_modules -> D:/DPF/node_modules) and pnpm workspace symlinks
// (node_modules/@dpf/types -> packages/types). A non-junction-safe `rm -rf`
// (or `Remove-Item -Recurse`, `git clean -fdx`) from one client then follows a
// link straight into the shared root and deletes the real files — the
// "cross-thread file sweep" AGENTS.md s4/s17 warns about.
//
// Shipped INSIDE the dpf-platform plugin (hooks/hooks.json, matcher "Bash") so
// the guard travels with the plugin to every surface (Claude/Codex/Grok) — NOT
// through run-hook.mjs, which forces exit 0 and so could never deny. Mirrors the
// lease-guard.mjs pattern (BI-CA0ED781 plugin hook plane).
//
// Decision protocol: to DENY, emit the PreToolUse permissionDecision JSON on
// stdout and exit 0; to ALLOW, exit 0 with no output. The hook fails OPEN — any
// parse/IO error allows the command (a guard must never wedge the session). It
// also only does filesystem lstat work AFTER a destructive-delete pattern is
// detected, so the common case (any non-delete Bash command) is pure-string-fast.
//
// What it does NOT block (junction-safe removals stay allowed):
//   - `rmdir <dir>` / `rd <dir>` (non-recursive — refuses to descend a junction)
//   - `git worktree remove <path>` (git is junction-aware)
//   - `[IO.Directory]::Delete($p,$false)` (the documented junction-safe delete)
//   - normal recursive deletes of a real (non-linked) dir inside your own worktree
// Emergency bypass: prefix the command with DPF_ALLOW_ROOT_CLONE_MUTATION=1.

import { lstatSync, statSync } from "node:fs";
import {
  readHookPayload,
  isShellTool,
  emitDeny,
  inDpfWorkspace,
  shellCommandFromInput,
} from "./lib/hook-io.mjs";

const WORKTREE_MARKER = "/.claude/worktrees/";

const GUIDANCE =
  "Destructive delete into the shared root clone blocked (BI-3FAA13A7). On this host, worktrees nested in the root share node_modules/packages via junctions+symlinks, so a recursive `rm -rf` / `Remove-Item -Recurse` / `git clean -fdx` follows a link into D:/DPF and wipes the real files — exactly how 730 packages/* files were deleted on 2026-06-19. " +
  "Junction-safe alternatives: remove a worktree with `git worktree remove <path>`; delete a junction with `rmdir <dir>` (non-recursive) or PowerShell `[IO.Directory]::Delete($p,$false)`; scope `git clean` with `-e` or run it only inside a non-junctioned dir. " +
  "If you truly mean to mutate the shared root, prefix the command with DPF_ALLOW_ROOT_CLONE_MUTATION=1.";

const ROOT_GIT_STATE_GUIDANCE =
  "Root clone git state mutation blocked (BI-B6AF69E1). The install/root clone must stay on main and clean; active work belongs in a sibling worktree such as D:/DPF-worktrees/<topic>. Raw `git switch`, `git checkout`, `git reset`, `git pull`, `git merge`, or `git rebase` in the root clone moves the checkout before the pre-commit guard can help and is how sessions strand D:/DPF on feature branches with uncommitted work. " +
  "Use scripts/new-dev-worktree.sh (or the surface worktree command) for feature work. If this is verified root-clone maintenance, prefix the command with DPF_ALLOW_ROOT_CLONE_MUTATION=1.";

// ── path helpers (forward-slash, drive-letter aware) ─────────────────────────

function norm(p) {
  let s = String(p ?? "").replace(/\\/g, "/");
  // Git Bash drive form `/d/DPF` -> `D:/DPF` so it compares against a Windows cwd.
  // (Single-letter segment only: `/Users/...` on Unix is untouched.)
  s = s.replace(/^\/([a-zA-Z])\//, (_m, d) => `${d.toUpperCase()}:/`);
  // Uppercase a `d:/` drive so casing never causes a compare miss on Windows.
  s = s.replace(/^([a-zA-Z]):\//, (_m, d) => `${d.toUpperCase()}:/`);
  return s.replace(/\/+$/g, "");
}

function isAbsolute(p) {
  return /^[A-Za-z]:\//.test(p) || p.startsWith("/");
}

/** Resolve `target` against `cwd`, collapsing . and .. segments. */
export function resolveAgainst(cwd, target) {
  const t = norm(target);
  const full = isAbsolute(t) ? t : `${norm(cwd)}/${t}`;
  const segs = full.split("/");
  const out = [];
  for (const s of segs) {
    if (s === "" ) { if (out.length === 0) out.push(""); continue; }
    if (s === ".") continue;
    if (s === "..") {
      if (out.length && out[out.length - 1] !== "" && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(s);
  }
  const joined = out.join("/");
  return joined === "" ? "/" : joined;
}

/**
 * The shared root clone for this cwd, or null when it can't be identified.
 *   - nested worktree (.../DPF/.claude/worktrees/<name>) -> the parent before the marker
 *   - main clone (cwd has a real .git DIRECTORY) -> cwd itself
 *   - sibling worktree / unknown -> null (its .git is a FILE; rely on the junction rule)
 */
export function deriveCloneRoot(cwd, isDir = () => false) {
  const c = norm(cwd);
  const i = c.indexOf(WORKTREE_MARKER);
  if (i >= 0) return c.slice(0, i);
  if (isDir(`${c}/.git`)) return c;
  return null;
}

/** True when `resolved` is the clone root or a shared file/dir in it (NOT the per-worktree area). */
export function isUnderRootSharedArea(resolved, cloneRoot) {
  if (!cloneRoot) return false;
  const r = norm(resolved);
  const base = norm(cloneRoot);
  if (r === base) return true; // deleting the clone root itself
  if (!r.startsWith(`${base}/`)) return false; // not under the clone
  if (r.startsWith(`${base}${WORKTREE_MARKER}`)) return false; // a worktree's own area is fine
  return true;
}

// ── command parsing ──────────────────────────────────────────────────────────

/** Split a compound command into segments on && || ; | and newlines. */
function segments(command) {
  return command.split(/&&|\|\||[;|\n]/g).map((s) => s.trim()).filter(Boolean);
}

/** Tokenize a segment, honoring simple single/double quotes; strips the quotes. */
function tokenize(seg) {
  const raw = seg.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return raw.map((t) => t.replace(/^['"]|['"]$/g, "").replace(/['"]/g, ""));
}

const isFlag = (t) => t.startsWith("-") || t.startsWith("/");
const baseName = (t) => norm(t).split("/").pop();

/**
 * Targets of a recursive delete in this segment, or [] if the segment is not a
 * recursive delete. Covers POSIX `rm -rf`, PowerShell `Remove-Item -Recurse`
 * (aliases rm/ri/del), and cmd `rmdir /s` / `rd /s`.
 */
export function recursiveDeleteTargets(seg) {
  const tokens = tokenize(seg);
  if (tokens.length === 0) return [];
  const cmd = baseName(tokens[0]).toLowerCase();
  const rest = tokens.slice(1);

  // POSIX rm (and Git Bash rm). Recursive if any short flag contains r/R or
  // --recursive. POSIX flags start with '-', so an absolute '/d/DPF/x' is a TARGET.
  if (cmd === "rm") {
    const recursive = rest.some((t) => /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t) || t === "--recursive");
    if (!recursive) return [];
    return rest.filter((t) => !t.startsWith("-"));
  }

  // PowerShell Remove-Item and aliases (ri, del, erase). Recursive via -Recurse / -r.
  if (cmd === "remove-item" || cmd === "ri" || cmd === "del" || cmd === "erase") {
    const recursive = rest.some((t) => /^-r(ecurse)?$/i.test(t));
    if (!recursive) return [];
    const targets = [];
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (/^-(path|literalpath)$/i.test(t) && rest[i + 1]) { targets.push(rest[++i]); continue; }
      if (!t.startsWith("-")) targets.push(t);
    }
    return targets;
  }

  // cmd.exe rmdir / rd — recursive via /s. cmd flags start with '/'.
  if (cmd === "rmdir" || cmd === "rd") {
    const recursive = rest.some((t) => /^\/s$/i.test(t));
    if (!recursive) return []; // a bare `rmdir <junction>` is the SAFE removal — allow it
    return rest.filter((t) => !t.startsWith("/") && !t.startsWith("-"));
  }

  return [];
}

/**
 * True when this segment is a `git clean` that removes ignored directories
 * (`-d` to recurse into dirs AND `-x`/`-X` to include ignored) — the form that
 * sweeps an ignored, junctioned node_modules and follows it into the shared root.
 */
export function isDestructiveGitClean(seg) {
  const tokens = tokenize(seg);
  const lower = tokens.map((t) => t.toLowerCase());
  const gi = lower.indexOf("git");
  if (gi < 0 || lower[gi + 1] !== "clean") return false;
  const flags = tokens.slice(gi + 2).filter(isFlag);
  // Combine short-flag letters, case-SENSITIVE (-x and -X both mean ignored files).
  const shortLetters = flags
    .filter((f) => /^-[A-Za-z]+$/.test(f))
    .map((f) => f.slice(1))
    .join("");
  const hasDir = shortLetters.includes("d") || flags.includes("--directory");
  const hasIgnored = /x/i.test(shortLetters) || flags.includes("-x") || flags.includes("-X");
  return hasDir && hasIgnored;
}

function gitSubcommandTargetCwd(seg, cwd) {
  const tokens = tokenize(seg);
  const lower = tokens.map((t) => t.toLowerCase());
  const gitIndex = lower.indexOf("git");
  if (gitIndex < 0) return null;

  let i = gitIndex + 1;
  let targetCwd = cwd;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "-C" && tokens[i + 1]) {
      targetCwd = resolveAgainst(cwd, tokens[i + 1]);
      i += 2;
      continue;
    }
    if ((token === "-c" || token === "--config-env") && tokens[i + 1]) {
      i += 2;
      continue;
    }
    if (token.startsWith("-")) {
      i += 1;
      continue;
    }
    break;
  }

  return { subcommand: lower[i] ?? "", targetCwd };
}

export function isRootCloneGitStateMutation(seg, cwd, isDir = () => false) {
  const parsed = gitSubcommandTargetCwd(seg, cwd);
  if (!parsed) return false;
  if (!["switch", "checkout", "reset", "pull", "merge", "rebase"].includes(parsed.subcommand)) {
    return false;
  }
  const target = norm(parsed.targetCwd);
  const cloneRoot = deriveCloneRoot(target, isDir);
  return cloneRoot !== null && target === cloneRoot;
}

// ── decision ─────────────────────────────────────────────────────────────────

/**
 * Pure decision: should this Bash command be blocked? Exported for unit tests.
 * @param {object} args
 * @param {string} args.command   the Bash command string
 * @param {string} [args.cwd]     the tool's working directory
 * @param {Record<string,string|undefined>} [args.env]
 * @param {(p:string)=>boolean} [args.isSymlink]  lstat().isSymbolicLink() for a path (junction on Windows)
 * @param {(p:string)=>boolean} [args.isDir]      statSync().isDirectory() for a path
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide({ command, cwd = "", env = {}, isSymlink = () => false, isDir = () => false }) {
  if (typeof command !== "string" || command.trim() === "") return { block: false };
  if (env.DPF_ALLOW_ROOT_CLONE_MUTATION === "1") return { block: false };
  if (/\bDPF_ALLOW_ROOT_CLONE_MUTATION=1\b/.test(command)) return { block: false };

  // Lazily resolve the clone root (one statSync of <cwd>/.git) only if we
  // actually hit a destructive delete — keeps the common non-delete path string-fast.
  let cloneRootMemo;
  const cloneRoot = () => (cloneRootMemo !== undefined ? cloneRootMemo : (cloneRootMemo = deriveCloneRoot(cwd, isDir)));

  for (const seg of segments(command)) {
    if (isRootCloneGitStateMutation(seg, cwd, isDir)) {
      return { block: true, reason: ROOT_GIT_STATE_GUIDANCE };
    }

    // `git clean -fdx` follows junctioned/ignored dirs into the shared root.
    if (isDestructiveGitClean(seg)) {
      return { block: true, reason: GUIDANCE };
    }

    const targets = recursiveDeleteTargets(seg);
    for (const target of targets) {
      const resolved = resolveAgainst(cwd, target);
      // (a) the target is a junction/symlink — a recursive delete follows it
      //     into its real target (the documented node_modules->root wipe).
      if (isSymlink(resolved)) return { block: true, reason: GUIDANCE };
      // (b) the target resolves into the shared root clone (escapes the worktree
      //     or names the clone's own packages/node_modules/etc).
      if (isUnderRootSharedArea(resolved, cloneRoot())) return { block: true, reason: GUIDANCE };
    }
  }

  return { block: false };
}

// ── runtime entry ──────────────────────────────────────────────────────────

function realIsSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}
function realIsDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open on read/parse error
  if (!inDpfWorkspace(payload.cwd)) process.exit(0); // DPF-scoped global hook: enforce only inside a DPF checkout

  if (!isShellTool(payload.toolName)) process.exit(0);
  const command = shellCommandFromInput(payload.toolInput);
  const cwd = payload.cwd ?? process.cwd();
  const verdict = decide({ command, cwd, env: process.env, isSymlink: realIsSymlink, isDir: realIsDir });
  if (!verdict.block) process.exit(0);

  emitDeny(verdict.reason); // dual-envelope deny — blocks on every surface
}

// Run only when invoked directly (not when imported by the test).
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("root-clone-guard.mjs")) {
  main();
}
