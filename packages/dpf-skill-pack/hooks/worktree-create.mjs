#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/worktree-create.mjs
//
// WorktreeCreate hook (BI-6B02FEE5): place Claude Code's AUTO-created worktrees
// at the canonical SIBLING base — `<dirname(root)>/<basename(root)>-worktrees/<name>`
// (e.g. D:/DPF -> D:/DPF-worktrees/<name>, ~/dpf -> ~/dpf-worktrees/<name>),
// branched off origin/main — instead of the default nesting INSIDE the root clone
// at `.claude/worktrees/<name>`. That nesting is the structural cause of the
// 2026-06-19 cross-thread file sweep (173 of 277 worktrees were nested in the
// root and shared its node_modules/packages via junctions, so a recursive delete
// from one followed a link into the root and wiped packages/*; root cause
// BI-3FAA13A7, delete-guard bleed-stop in root-clone-guard.mjs). This is the
// full-enforcement form of the contract scripts/new-dev-worktree.sh already
// applies to the MANUAL path — extended here to Claude's auto-create path.
//
// Contract (Claude Code WorktreeCreate): the hook REPLACES the default
// `git worktree add`. It receives {base_path, worktree_name, ...} on stdin, must
// create the worktree itself, and prints the resulting absolute path to stdout
// (the form scripts/hooks/run-hook.mjs documents: "a WorktreeCreate script can
// still print its path"). There is no built-in fallback — a non-zero exit or no
// output aborts worktree creation — so this hook FAILS SAFE: on any error it
// falls back to creating at the default nested location (now protected by the
// merged root-clone delete-guard) so worktree creation is never broken.
//
// Cross-platform Node (the one runtime guaranteed for Claude Code hooks); a
// single .mjs avoids needing both a .ps1 and a .sh. Wired directly under the
// WorktreeCreate event in the plugin hooks.json (NOT through run-hook.mjs, which
// forces exit 0). Only Claude Code emits WorktreeCreate today; Codex/Grok get the
// canonical base via scripts/new-dev-worktree.sh / a CLI wrapper (BI follow-up).

import { readFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// ── pure planning (unit-tested) ──────────────────────────────────────────────

/** Sanitize Claude's worktree_name into a single safe path segment + branch. */
export function safeWorktreeName(name) {
  return String(name ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .join("-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Given the resolved MAIN clone root and Claude's worktree name, compute the
 * canonical sibling base, the worktree target path, and the branch name.
 * Mirrors scripts/new-dev-worktree.sh: `$(dirname root)/$(basename root)-worktrees`.
 * Works in forward-slash space so it is deterministic across win32/posix.
 * Returns null when the inputs can't yield a safe plan (caller falls back).
 */
export function planWorktree({ mainRoot, worktreeName }) {
  const root = String(mainRoot ?? "").replace(/\\/g, "/").replace(/\/+$/g, "");
  const slash = root.lastIndexOf("/");
  const safe = safeWorktreeName(worktreeName);
  if (slash < 1 || !safe) return null;
  const parent = root.slice(0, slash);
  const leaf = root.slice(slash + 1);
  const base = `${parent}/${leaf}-worktrees`;
  return { base, target: `${base}/${safe}`, branch: safe };
}

// ── git helpers ──────────────────────────────────────────────────────────────

function git(root, args, { allowFail = false, timeout } = {}) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true,
      ...(timeout ? { timeout } : {}) }).trim();
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

/** First `worktree <path>` line of porcelain output = the MAIN worktree, even
 *  when invoked from a linked worktree (matches new-dev-worktree.sh). */
function resolveMainRoot(basePath) {
  const out = git(basePath, ["worktree", "list", "--porcelain"], { allowFail: true });
  const m = out && out.match(/^worktree (.+)$/m);
  return m ? m[1].trim().replace(/\\/g, "/") : null;
}

function branchExists(root, branch) {
  return git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { allowFail: true }) != null;
}

function originMainAvailable(root) {
  return git(root, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"], { allowFail: true }) != null;
}

/** Create (or reuse) a worktree at `target` on `branch`, off origin/main when
 *  available. Idempotent: an existing target dir is treated as already-created. */
function addWorktree(root, target, branch) {
  if (existsSync(target)) return target; // already there — reuse (new-dev-worktree's skip)
  const parent = target.slice(0, target.lastIndexOf("/"));
  if (parent) mkdirSync(parent, { recursive: true });
  if (branchExists(root, branch)) {
    git(root, ["worktree", "add", target, branch]);
  } else {
    const baseRef = originMainAvailable(root) ? "origin/main" : "HEAD";
    git(root, ["worktree", "add", target, "-b", branch, baseRef]);
  }
  return target;
}


// ── bind-at-birth (BI-0B292D84 layer 1) ──────────────────────────────────────

/**
 * Claim a Workroom for the branch this hook just created.
 *
 * TWO CONSTRAINTS SHAPE THIS.
 *
 * 1. STDOUT IS THE RETURN VALUE. Claude Code reads the created path from this
 *    hook's stdout, so binding output goes to stderr only. A stray stdout write
 *    here does not make a noisy log, it corrupts the worktree path.
 *
 * 2. THE IMPORT COMES FROM THE VERIFIED SOURCE CHECKOUT, never the surrounding
 *    package layout. A copied plugin has no ../../../scripts. The checkout we
 *    just created carries the canonical binder at its observed source version;
 *    the read-only main checkout may be older. Foreign or unsupported source
 *    cannot become a claim. Keep this dynamic so absent source is fail-soft.
 *
 * Binding NEVER blocks worktree creation. A tree that could not be bound is
 * still a usable tree; it is just one the claim guard will flag.
 */
async function bindAtBirth({ mainRoot, worktreePath, branch }) {
  let bind;
  try {
    const headSha = git(mainRoot, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`], { timeout: 3000 });
    const source = verifiedBindingSource({ mainRoot, worktreePath, branch, headSha });
    const module = await import(pathToFileURL(source).href);
    if (typeof module.bindWorktreeToWorkroom !== "function" || typeof module.resolveWorktreeSourceIdentity !== "function") {
      throw new Error("source binder lacks the source identity contract");
    }
    bind = module.bindWorktreeToWorkroom;
  } catch (error) {
    process.stderr.write(`[worktree-create] workroom binding unavailable (${error?.message ?? "source helper unavailable"}) — claim a Workroom manually with adopt_worktree.\n`);
    return;
  }
  try {
    const gitDir = git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-dir"], { timeout: 3000 });
    const result = await bind({
      branch,
      worktreePath,
      gitDir,
      captureSourceIdentity: true,
    });
    if (result.status === "bound") {
      process.stderr.write(`[worktree-create] Workroom claimed for ${branch}: ${result.capsuleId}\n`);
    } else {
      process.stderr.write(`[worktree-create] NOT bound to a Workroom (${result.status}: ${result.reason}) — AGENTS.md 12 still requires a claim; call adopt_worktree before you work.\n`);
    }
  } catch (err) {
    process.stderr.write(`[worktree-create] workroom binding failed: ${err?.message ?? err}\n`);
  }
}

/** Resolve only the checkout whose branch and shared Git repository we created. */
export function verifiedBindingSource({ mainRoot, worktreePath, branch, headSha }) {
  const real = path => realpathSync.native(path);
  const same = (left, right) => process.platform === "win32"
    ? real(left).toLowerCase() === real(right).toLowerCase() : real(left) === real(right);
  const read = (root, args) => git(root, args, { timeout: 3000 });
  const root = real(worktreePath);
  if (!/^[a-f0-9]{40}$/i.test(headSha ?? "")
    || !same(root, read(root, ["rev-parse", "--show-toplevel"]))
    || read(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== branch
    || read(root, ["rev-parse", "--verify", "HEAD^{commit}"]) !== headSha
    || !same(read(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      read(mainRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))) {
    throw new Error("source checkout, branch or shared repository conflicts with worktree creation");
  }
  if (!existsSync(join(root, "AGENTS.md")) || !existsSync(join(root, "packages/dpf-skill-pack/toolchain-version.json"))) {
    throw new Error("created checkout is not a DPF source checkout");
  }
  const source = real(join(root, "scripts/lib/workroom-bind.mjs"));
  const inside = relative(root, source);
  if (inside === ".." || inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(inside)) {
    throw new Error("source binder escapes the verified checkout");
  }
  return source;
}

// ── runtime entry ────────────────────────────────────────────────────────────

async function main() {
  let payload;
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.exit(1); // can't read the request — let Claude surface the failure
  }

  const basePath = String(payload?.base_path ?? payload?.cwd ?? process.cwd()).replace(/\\/g, "/");
  const worktreeName = payload?.worktree_name ?? "";

  // Preferred path: canonical sibling base off origin/main.
  try {
    const mainRoot = resolveMainRoot(basePath) ?? basePath;
    git(mainRoot, ["fetch", "origin", "--quiet"], { allowFail: true }); // freshen origin/main, best-effort
    const plan = planWorktree({ mainRoot, worktreeName });
    if (!plan) throw new Error(`cannot plan a worktree for name=${JSON.stringify(worktreeName)} root=${mainRoot}`);
    const created = addWorktree(mainRoot, plan.target, plan.branch);
    // Bind BEFORE returning the path: the claim is part of creating the
    // worktree, not a follow-up someone remembers. Bounded and fail-soft.
    await bindAtBirth({ mainRoot, worktreePath: created, branch: plan.branch });
    process.stdout.write(created);
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `[worktree-create] canonical placement failed (${err instanceof Error ? err.message : String(err)}); ` +
        `falling back to the default nested location — still protected by root-clone-guard.\n`,
    );
  }

  // Fail-safe: reproduce Claude's default so worktree creation is NEVER broken.
  try {
    const mainRoot = resolveMainRoot(basePath) ?? basePath;
    const safe = safeWorktreeName(worktreeName) || `wt-${process.pid}`;
    const target = `${mainRoot}/.claude/worktrees/${safe}`;
    const created = addWorktree(mainRoot, target, safe);
    process.stdout.write(created);
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `[worktree-create] fallback placement also failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

// Run only when invoked directly (not when imported by the test).
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("worktree-create.mjs")) {
  main();
}
