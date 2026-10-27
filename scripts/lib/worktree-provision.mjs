// Governed worktree provisioning: admit and bind BEFORE the worktree exists,
// and fail closed (BI-D1FB8C4D, design
// docs/superpowers/specs/2026-10-14-worktree-provisioning-under-gpp-design.md §4,
// WWMD DI-F603138224BB).
//
// WHY THE ORDER MATTERS
//   The WorktreeCreate hook used to run `git worktree add` first and bind the
//   Workroom afterwards, warning on any failure. A worktree that could not be
//   bound was still created, so binding was advice. And because the hook loaded
//   the bind library relative to the plugin cache, where scripts/ does not
//   exist, the installed hook never bound anything: 5 of 40 recent worktrees
//   carried a claim. Here the platform is asked first. `adopt_worktree` runs
//   the server-side provisioning admission (worktree-provision-admission.ts),
//   so a room whose work shape does not admit `worktree-provision` (a read-only
//   source-inquiry room) is refused before anything exists on disk.
//
// FAILING CLOSED, AND THE ONE WAY OUT
//   No token, an unreachable platform or an unusable answer refuses. The only
//   override is the operator break-glass AGENTS.md §1 describes:
//   DPF_WORKTREE_BREAK_GLASS=<reason>. It applies ONLY when the platform cannot
//   be asked. It never turns a refusal into a creation, because a refusal is an
//   authorization answer, not an outage. A break-glass tree gets a pending
//   marker, never a claim marker: the claim guard reads the claim marker as
//   proof, and nothing was proven.
//
// One entry point for every path that creates a DPF worktree: the WorktreeCreate
// hook and scripts/new-dev-worktree.sh both call provisionWorktree.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isEntryModule } from "./entry-module.mjs";
import { bindWorktreeToWorkroom, toPosixPath, writeClaimMarker } from "./workroom-bind.mjs";

export const BREAK_GLASS_ENV = "DPF_WORKTREE_BREAK_GLASS";
export const PENDING_MARKER_NAME = "dpf-workroom-pending.json";
export const SOURCE_READ_TOOLS = ["read_source_at_version", "search_source_at_version", "list_source_directory", "read_project_file"];

/** The operator's break-glass reason, or null when none is set. */
export function breakGlassReason(env = process.env) {
  const reason = String(env[BREAK_GLASS_ENV] ?? "").trim();
  return reason || null;
}

// ── default effects (replaced in tests) ──────────────────────────────────────

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function gitOrNull(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

/** Create (or reuse) the worktree: the existing branch, or a new one off origin/main. */
export function addWorktree(mainRoot, target, branch) {
  if (fs.existsSync(target)) return target;
  const parent = path.dirname(target);
  if (parent) fs.mkdirSync(parent, { recursive: true });
  if (gitOrNull(mainRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) != null) {
    git(mainRoot, ["worktree", "add", target, branch]);
  } else {
    const baseRef = gitOrNull(mainRoot, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]) != null ? "origin/main" : "HEAD";
    git(mainRoot, ["worktree", "add", target, "-b", branch, baseRef]);
  }
  return target;
}

function resolveGitDir(worktreePath) {
  return gitOrNull(worktreePath, ["rev-parse", "--path-format=absolute", "--git-dir"]);
}

function repositoryFullNameOf(mainRoot) {
  const remote = gitOrNull(mainRoot, ["config", "--get", "remote.origin.url"]) ?? "";
  const match = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : "OpenDigitalProductFactory/opendigitalproductfactory";
}

export function writePendingMarker(gitDir, record) {
  fs.writeFileSync(path.join(gitDir, PENDING_MARKER_NAME), JSON.stringify(record), "utf8");
}

/**
 * After creation: re-adopt with the source identity observed in the new
 * checkout (bindWorktreeToWorkroom's captureSourceIdentity), which also caches
 * the claim marker. The WorktreeCreate hook replaces this with its own
 * verified-source binder (BI-0B292D84 packaged binding).
 */
async function recordSourceIdentity({ worktreePath, branch, bound, env }) {
  const gitDir = resolveGitDir(worktreePath);
  const result = await bindWorktreeToWorkroom({ branch, worktreePath, gitDir, captureSourceIdentity: true, env });
  if (result.status !== "bound" && gitDir && bound.marker) {
    try { writeClaimMarker(gitDir, bound.marker); } catch { /* the guard re-derives it */ }
  }
  return result;
}

export const DEFAULT_EFFECTS = {
  bind: bindWorktreeToWorkroom,
  afterCreate: recordSourceIdentity,
  addWorktree,
  resolveGitDir,
  repositoryFullNameOf,
  writePendingMarker,
  now: () => new Date(),
};

// ── the governed sequence ────────────────────────────────────────────────────

function refusalMessage(result) {
  return `[worktree-provision] Refused (${result.code ?? "refused"}): ${result.reason}. `
    + `Nothing was created. Read source through ${SOURCE_READ_TOOLS.join(", ")} instead; `
    + "if the work needs a change, claim the backlog item with a delivery shape first.";
}

/**
 * Admit, bind, then create. Never throws: every outcome is returned as data so
 * the caller decides its exit code and what to print.
 *
 * @returns {Promise<
 *   | { status: "created", path: string, capsuleId: string }
 *   | { status: "break-glass", path: string, reason: string }
 *   | { status: "refused", code: string, message: string }
 *   | { status: "unavailable", message: string }
 *   | { status: "failed", message: string, capsuleId?: string }
 * >}
 */
export async function provisionWorktree({ mainRoot, plan, env = process.env, effects = DEFAULT_EFFECTS }) {
  const fx = { ...DEFAULT_EFFECTS, ...effects };
  const worktreePath = toPosixPath(plan.target);
  const repositoryFullName = fx.repositoryFullNameOf(mainRoot);

  // 1. Ask the platform first. No gitDir: there is nothing on disk to mark yet.
  const bound = await fx.bind({ branch: plan.branch, worktreePath, gitDir: null, repositoryFullName, env });

  if (bound.status === "refused" || bound.status === "error") {
    const code = bound.code ?? (bound.status === "error" ? "bind_unusable" : "refused");
    return { status: "refused", code, message: refusalMessage({ ...bound, code }) };
  }

  if (bound.status === "unavailable") {
    const reason = breakGlassReason(env);
    if (!reason) {
      return {
        status: "unavailable",
        message: `[worktree-provision] The platform could not admit this worktree (${bound.reason}), so it was not created. `
          + `Restore MCP access, or, only if an operator authorizes recovery while the platform is down, set ${BREAK_GLASS_ENV}=<reason>.`,
      };
    }
    // 6. Break-glass: create, mark pending, say so. Never a claim marker.
    try {
      const created = fx.addWorktree(mainRoot, plan.target, plan.branch);
      const gitDir = fx.resolveGitDir(created);
      if (gitDir) {
        fx.writePendingMarker(gitDir, {
          reason,
          branch: plan.branch,
          worktreePath,
          recordedAt: fx.now().toISOString(),
          unavailable: bound.reason,
        });
      }
      return { status: "break-glass", path: created, reason };
    } catch (err) {
      return { status: "failed", message: `[worktree-provision] break-glass creation failed: ${err?.message ?? err}` };
    }
  }

  // 4. Admitted and bound: now create.
  let created;
  try {
    created = fx.addWorktree(mainRoot, plan.target, plan.branch);
  } catch (err) {
    return {
      status: "failed",
      capsuleId: bound.capsuleId,
      message: `[worktree-provision] Workroom ${bound.capsuleId} is bound but git worktree add failed: ${err?.message ?? err}. `
        + "Retrying reuses the same Workroom.",
    };
  }

  // 5. Record what now exists: re-adopt with the observed source identity
  //    (idempotent, same room) and cache the claim marker. The claim already
  //    exists from step 3, so a failure here is a warning, not a refusal.
  let warning = null;
  try {
    const after = await fx.afterCreate({ mainRoot, worktreePath: created, branch: plan.branch, bound, env });
    if (after && after.status !== "bound") warning = `source identity not recorded (${after.status}: ${after.reason})`;
  } catch (err) {
    warning = `source identity not recorded (${err?.message ?? err})`;
  }
  return { status: "created", path: created, capsuleId: bound.capsuleId, ...(warning ? { warning } : {}) };
}

// ── CLI (scripts/new-dev-worktree.sh) ────────────────────────────────────────
// node scripts/lib/worktree-provision.mjs --main-root <root> --target <path> --branch <branch>
// Prints the created path on stdout; exits 0 created/break-glass, 1 otherwise.

export function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--main-root") out.mainRoot = argv[++i];
    else if (key === "--target") out.target = argv[++i];
    else if (key === "--branch") out.branch = argv[++i];
  }
  return out.mainRoot && out.target && out.branch ? out : null;
}

if (isEntryModule(import.meta.url)) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write("usage: worktree-provision.mjs --main-root <root> --target <path> --branch <branch>\n");
    process.exit(2);
  }
  const out = await provisionWorktree({ mainRoot: args.mainRoot, plan: { target: args.target, branch: args.branch } });
  if (out.status === "created" || out.status === "break-glass") {
    process.stderr.write(out.status === "created"
      ? `[worktree-provision] Workroom ${out.capsuleId} bound before creation.\n`
      : `[worktree-provision] BREAK-GLASS: created UNBOUND (reason: ${out.reason}); bind it with adopt_worktree once the platform is back.\n`);
    process.stdout.write(`${out.path}\n`);
    process.exit(0);
  }
  process.stderr.write(`${out.message}\n`);
  process.exit(1);
}
