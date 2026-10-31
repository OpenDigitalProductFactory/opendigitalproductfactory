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
// still print its path"). A non-zero exit or no output aborts worktree creation.
//
// GOVERNED PROVISIONING (BI-D1FB8C4D). In a DPF source repository this hook no
// longer creates first and binds afterwards. It runs the repository's
// provisioning library (scripts/lib/worktree-provision.mjs): the platform admits
// and binds the Workroom BEFORE the worktree exists, and a refusal or an
// unreachable platform creates nothing. The old fail-safe fallback to the nested
// .claude/worktrees location is gone: it was the path by which an unbound tree
// was always created. The only override is the operator break-glass,
// DPF_WORKTREE_BREAK_GLASS=<reason>, for a platform that cannot be asked.
// Other repositories get a plain `git worktree add` at the sibling base.
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
export function addWorktree(root, target, branch) {
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
 * This runs AFTER governed provisioning has already admitted and bound the
 * room: it re-adopts with the observed source identity and caches the claim
 * marker. The claim already exists, so a failure here is reported, not fatal.
 * Returns the binder's result (or an unavailable result) for the caller.
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
    return { status: "unavailable", reason: error?.message ?? "source helper unavailable" };
  }
  try {
    const gitDir = git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-dir"], { timeout: 3000 });
    return await bind({
      branch,
      worktreePath,
      gitDir,
      captureSourceIdentity: true,
    });
  } catch (err) {
    return { status: "unavailable", reason: `workroom binding failed: ${err?.message ?? err}` };
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

// ── governed provisioning (BI-D1FB8C4D) ──────────────────────────────────────

/** Where the governed provisioning library lives in the repository being provisioned. */
export function provisionLibraryPath(mainRoot) {
  return `${String(mainRoot).replace(/\\/g, "/").replace(/\/+$/g, "")}/scripts/lib/worktree-provision.mjs`;
}

/**
 * Decide and run. A DPF source repository (one that carries the provisioning
 * library) is admitted and bound BEFORE creation, and refused or unreachable
 * means no worktree. Any other repository gets a plain `git worktree add`.
 * There is no nested `.claude/worktrees` fallback. `deps` is injected by tests.
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string[] }>}
 */
export async function runWorktreeCreate({ mainRoot, worktreeName, env = process.env, deps }) {
  const stderr = [];
  const plan = planWorktree({ mainRoot, worktreeName });
  if (!plan) {
    stderr.push(`[worktree-create] cannot plan a worktree for name=${JSON.stringify(worktreeName)} root=${mainRoot}; nothing was created.`);
    return { exitCode: 1, stdout: "", stderr };
  }

  const libraryPath = provisionLibraryPath(mainRoot);
  if (!deps.exists(libraryPath)) {
    let created;
    try {
      created = deps.addWorktree(mainRoot, plan.target, plan.branch);
    } catch (err) {
      stderr.push(`[worktree-create] git worktree add failed: ${err instanceof Error ? err.message : String(err)}`);
      return { exitCode: 1, stdout: "", stderr };
    }
    // A DPF checkout older than the provisioning library still binds after
    // creation, as before, so a plugin that updates ahead of the root clone
    // never stops binding. In any other repository the verified-source
    // binder finds no DPF source and nothing is said.
    const after = deps.afterCreate ? await deps.afterCreate({ worktreePath: created, branch: plan.branch }) : null;
    if (after?.status === "bound") stderr.push(`[worktree-create] Workroom ${after.capsuleId} bound after creation (this checkout predates governed provisioning).`);
    return { exitCode: 0, stdout: created, stderr };
  }

  let provisionWorktree;
  try {
    ({ provisionWorktree } = await deps.importLibrary(libraryPath));
    if (typeof provisionWorktree !== "function") throw new Error("library lacks provisionWorktree");
  } catch (err) {
    stderr.push(`[worktree-create] cannot load ${libraryPath} (${err instanceof Error ? err.message : String(err)}); nothing was created.`);
    return { exitCode: 1, stdout: "", stderr };
  }

  const out = await provisionWorktree({
    mainRoot,
    plan,
    env,
    effects: { addWorktree: deps.addWorktree, afterCreate: deps.afterCreate },
  });
  if (out.status === "created") {
    stderr.push(`[worktree-create] Workroom ${out.capsuleId} admitted and bound before creation: ${out.path}`);
    if (out.warning) stderr.push(`[worktree-create] ${out.warning}`);
    return { exitCode: 0, stdout: out.path, stderr };
  }
  if (out.status === "break-glass") {
    stderr.push(`[worktree-create] BREAK-GLASS: created ${out.path} UNBOUND (reason: ${out.reason}). A pending marker records it; bind it with adopt_worktree once the platform is back.`);
    return { exitCode: 0, stdout: out.path, stderr };
  }
  stderr.push(out.message);
  return { exitCode: 1, stdout: "", stderr };
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
  const mainRoot = resolveMainRoot(basePath) ?? basePath;
  git(mainRoot, ["fetch", "origin", "--quiet"], { allowFail: true }); // freshen origin/main, best-effort

  const result = await runWorktreeCreate({
    mainRoot,
    worktreeName: payload?.worktree_name ?? "",
    deps: {
      exists: existsSync,
      importLibrary: (libraryPath) => import(pathToFileURL(libraryPath).href),
      addWorktree,
      // After creation, re-adopt through the binder of the checkout just
      // created, verified and with its source identity (BI-0B292D84).
      afterCreate: ({ worktreePath, branch }) => bindAtBirth({ mainRoot, worktreePath, branch }),
    },
  });
  for (const line of result.stderr) process.stderr.write(`${line}\n`);
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.exitCode);
}

// Run only when invoked directly (not when imported by the test).
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("worktree-create.mjs")) {
  main();
}
