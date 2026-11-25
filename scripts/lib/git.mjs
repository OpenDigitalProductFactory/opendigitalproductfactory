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
//   runGitAsync(args, o)   -> Promise<{ ok, stdout, stderr, status, timedOut }>
//                             never rejects; for long git work in a server
//                             process, where a synchronous spawn would stall it
//
// "I could not run git" is not "git printed nothing" (BI-B6433DC6): a caller
// that wants partial output on failure reads `runGit(...).stdout` and says so.
//
// Options: cwd (default: repo root), trim, maxBuffer, timeout, env, input
// (stdin for batch commands), binary (stdout as a Buffer), exec (a test seam
// with execFileSync's signature).

import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The tracked inventory alone exceeds Node's 1 MiB default. Keep a finite
// shared ceiling while preserving tighter or larger explicit caller limits.
function execOptions({ cwd = REPO_ROOT, maxBuffer = 16 * 1024 * 1024, timeout, env, input, binary = false } = {}) {
  const options = {
    cwd,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    windowsHide: true,
  };
  // No encoding returns a Buffer, which batch output with byte-counted sizes needs.
  if (!binary) options.encoding = "utf8";
  if (input !== undefined) options.input = input;
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
    if (opts.binary) return { ok: true, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ""), stderr: "", status: 0 };
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
  if (opts.binary) return result.stdout;
  return trim ? result.stdout.trim() : result.stdout;
}

/** stdout of a git command, or null when it fails (an absent ref, a non-repo). */
export function gitTextOrNull(args, { trim = true, ...opts } = {}) {
  const result = runGit(args, opts);
  if (!result.ok) return null;
  return trim ? result.stdout.trim() : result.stdout;
}

/**
 * runGit without blocking the event loop, for long git work inside a server
 * process (upgrade source preparation runs fetches and merges for minutes).
 * Never rejects. A run killed by `timeout` reports `timedOut` and status 124.
 * Options: cwd, maxBuffer, timeout, env, killSignal; `execAsync` is a test
 * seam with execFile's signature.
 */
export function runGitAsync(args, { execAsync = execFile, cwd = REPO_ROOT, maxBuffer = 16 * 1024 * 1024, timeout, env, killSignal } = {}) {
  const options = { cwd, maxBuffer, windowsHide: true, encoding: "utf8" };
  if (timeout !== undefined) options.timeout = timeout;
  if (env !== undefined) options.env = env;
  if (killSignal !== undefined) options.killSignal = killSignal;
  return new Promise((resolve) => {
    execAsync("git", args, options, (err, stdout, stderr) => {
      const out = String(stdout ?? "");
      const errOut = String(stderr ?? "");
      if (!err) return resolve({ ok: true, stdout: out, stderr: errOut, status: 0, timedOut: false });
      const timedOut = err.killed === true;
      resolve({
        ok: false,
        stdout: out,
        stderr: errOut || (timedOut ? `git timed out after ${timeout}ms and was terminated` : err.message || ""),
        status: timedOut ? 124 : typeof err.code === "number" ? err.code : 1,
        timedOut,
      });
    });
  });
}
