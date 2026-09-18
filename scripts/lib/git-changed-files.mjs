// scripts/lib/git-changed-files.mjs
//
// BI-20599979 / BI-B6433DC6 — one honesty helper for every diff-scoped guard.
// "I could not compute the diff" is not "the diff was empty".

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Run git in the repo. Distinguishes success from failure — never collapse a
 * failed invocation into an empty string (BI-B6433DC6).
 */
export function runGit(args, { exec = execFileSync, cwd = REPO_ROOT } = {}) {
  try {
    const stdout = exec("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: String(stdout ?? ""), stderr: "" };
  } catch (e) {
    return {
      ok: false,
      stdout: (e.stdout && e.stdout.toString()) || "",
      stderr: (e.stderr && e.stderr.toString()) || e.message || "",
      status: e.status ?? 1,
    };
  }
}

/**
 * When set to "1", every diff-scoped gate also counts uncommitted work: staged,
 * unstaged and untracked files. That is what lets `pnpm gate:local` judge a
 * change BEFORE its first commit instead of after three hook cycles
 * (BI-85270E96). CI never sets it; a committed diff is what merges.
 */
export const INCLUDE_WORKING_TREE_ENV = "DPF_GATE_INCLUDE_WORKING_TREE";

export function includesWorkingTree(env = process.env) {
  return env[INCLUDE_WORKING_TREE_ENV] === "1";
}

/**
 * Uncommitted paths: staged and unstaged changes against HEAD plus untracked
 * files that are not ignored. `unresolvable` when git cannot answer.
 */
export function listWorkingTreeFiles({ git = runGit, diffArgs = [] } = {}) {
  const diff = git(["diff", "--name-only", ...diffArgs, "HEAD"]);
  if (!diff.ok) return { status: "unresolvable", files: [], detail: (diff.stderr || diff.stdout || "").trim() };
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  if (!untracked.ok) return { status: "unresolvable", files: [], detail: (untracked.stderr || untracked.stdout || "").trim() };
  const files = [...diff.stdout.split("\n"), ...untracked.stdout.split("\n")].map((s) => s.trim()).filter(Boolean);
  return { status: "ok", files: [...new Set(files)], detail: "" };
}

/**
 * Files changed vs `base`. An unresolvable ref or a failed three-dot diff is
 * `unresolvable`, never an empty list.
 *
 * `diffArgs` are extra `git diff` selectors inserted before the range — the
 * escape hatch that keeps `--diff-filter=…` callers on this helper instead of
 * writing their own error-swallowing diff.
 *
 * With DPF_GATE_INCLUDE_WORKING_TREE=1 the committed diff is unioned with the
 * working tree, so the same gate answers the same way before and after commit.
 */
export function listChangedFiles(base, { git = runGit, diffArgs = [], env = process.env } = {}) {
  const parsed = git(["rev-parse", "--verify", `${base}^{commit}`]);
  if (!parsed.ok) {
    return {
      status: "unresolvable",
      files: [],
      detail: (parsed.stderr || parsed.stdout || "").trim(),
    };
  }
  // `diffArgs` carries caller-specific selectors (e.g. --diff-filter=AM) so a
  // guard that needs them still gets the unresolvable-vs-empty distinction
  // rather than hand-rolling its own swallowing diff.
  const diff = git(["diff", "--name-only", ...diffArgs, `${base}...HEAD`]);
  if (!diff.ok) {
    return {
      status: "unresolvable",
      files: [],
      detail: (diff.stderr || diff.stdout || "").trim(),
    };
  }
  const files = diff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!includesWorkingTree(env)) return { status: "ok", files, detail: "" };
  const working = listWorkingTreeFiles({ git, diffArgs });
  if (working.status === "unresolvable") return working;
  return { status: "ok", files: [...new Set([...files, ...working.files])], detail: "" };
}

/** Print the shared unresolvable-base contract and exit 1. */
export function exitUnresolvable(prefix, base, detail) {
  console.error(`[${prefix}] cannot resolve ${base} — the guard did not run. This is not a pass.`);
  console.error(`[${prefix}] Remedy: git fetch --deepen 50 origin  (or git fetch origin main) and re-run.`);
  if (detail) console.error(`[${prefix}] git: ${detail}`);
  process.exit(1);
}

/** listChangedFiles then exit if the base could not be resolved. */
export function requireChangedFiles(base, prefix) {
  const listed = listChangedFiles(base);
  if (listed.status === "unresolvable") exitUnresolvable(prefix, base, listed.detail);
  return listed.files;
}
