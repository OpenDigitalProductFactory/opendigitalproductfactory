// scripts/lib/git.mjs
//
// The one way scripts run git (plan 2026-09-08 §10.5 S1). Scripts used to carry
// more than thirty local `git()` / `runGit()` wrappers with three argument
// orders and five failure behaviours: throw, return null, return "", return
// partial stdout, or hand back the raw spawn result. Each call site now picks a
// failure behaviour by name instead of inheriting whichever copy it pasted.
//
//   runGit(args, opts)     -> { ok, stdout, stderr, status }   never throws
//   gitText(args, opts)    -> stdout, throws GitCommandError   (trim by default)
//   gitTextOrNull(args, o) -> stdout or null on failure        (trim by default)
//
// "I could not run git" is not "git printed nothing" (BI-B6433DC6): a caller
// that wants partial output on failure reads `runGit(...).stdout` and says so.
//
// Options: cwd (default: repo root), trim, maxBuffer, timeout, env, exec (a
// test seam with execFileSync's signature).

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function execOptions({ cwd = REPO_ROOT, maxBuffer, timeout, env } = {}) {
  const options = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
  if (maxBuffer !== undefined) options.maxBuffer = maxBuffer;
  if (timeout !== undefined) options.timeout = timeout;
  if (env !== undefined) options.env = env;
  return options;
}

export class GitCommandError extends Error {
  constructor(args, result) {
    const detail = (result.stderr || result.stdout || "").trim();
    super(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
    this.name = "GitCommandError";
    this.args = args;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.status = result.status;
  }
}

/** Run git. Never throws; `ok` says whether it exited 0. */
export function runGit(args, { exec = execFileSync, ...opts } = {}) {
  try {
    const stdout = exec("git", args, execOptions(opts));
    return { ok: true, stdout: String(stdout ?? ""), stderr: "", status: 0 };
  } catch (e) {
    return {
      ok: false,
      stdout: (e.stdout && e.stdout.toString()) || "",
      stderr: (e.stderr && e.stderr.toString()) || e.message || "",
      status: typeof e.status === "number" ? e.status : 1,
    };
  }
}

/** stdout of a git command that must succeed; throws GitCommandError otherwise. */
export function gitText(args, { trim = true, ...opts } = {}) {
  const result = runGit(args, opts);
  if (!result.ok) throw new GitCommandError(args, result);
  return trim ? result.stdout.trim() : result.stdout;
}

/** stdout of a git command, or null when it fails (an absent ref, a non-repo). */
export function gitTextOrNull(args, { trim = true, ...opts } = {}) {
  const result = runGit(args, opts);
  if (!result.ok) return null;
  return trim ? result.stdout.trim() : result.stdout;
}
