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
 * Files changed vs `base`. An unresolvable ref or a failed three-dot diff is
 * `unresolvable`, never an empty list.
 */
export function listChangedFiles(base, { git = runGit } = {}) {
  const parsed = git(["rev-parse", "--verify", `${base}^{commit}`]);
  if (!parsed.ok) {
    return {
      status: "unresolvable",
      files: [],
      detail: (parsed.stderr || parsed.stdout || "").trim(),
    };
  }
  const diff = git(["diff", "--name-only", `${base}...HEAD`]);
  if (!diff.ok) {
    return {
      status: "unresolvable",
      files: [],
      detail: (diff.stderr || diff.stdout || "").trim(),
    };
  }
  const files = diff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  return { status: "ok", files, detail: "" };
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
