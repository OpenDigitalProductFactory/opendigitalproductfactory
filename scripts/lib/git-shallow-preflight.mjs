#!/usr/bin/env node
// BI-8304AB09 — fail loud on shallow clones and stale shallow.lock so gates
// never surface "no merge base" / "unrelated histories" as if main were rewritten.
//
// Used by local-ci-runner (and callable from other three-dot-diff callers).

import { existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

/**
 * Detect a stale `.git/shallow.lock` left by a crashed git (0-byte, no live git).
 * @param {string} gitDir absolute git common dir or .git path
 * @returns {{ path: string, stale: boolean, size: number } | null}
 */
export function inspectShallowLock(gitDir) {
  const lockPath = join(gitDir, "shallow.lock");
  if (!existsSync(lockPath)) return null;
  let size = 0;
  try {
    size = statSync(lockPath).size;
  } catch {
    return { path: lockPath, stale: false, size: 0 };
  }
  // BI-8304AB09: a 0-byte lock with no live git process is stale debris.
  const ps = spawnSync(
    process.platform === "win32" ? "tasklist" : "pgrep",
    process.platform === "win32" ? ["/FI", "IMAGENAME eq git.exe", "/NH"] : ["-x", "git"],
    { encoding: "utf8" },
  );
  const out = `${ps.stdout || ""}${ps.stderr || ""}`;
  const liveGit =
    process.platform === "win32"
      ? /git\.exe/i.test(out) && !/No tasks are running/i.test(out)
      : ps.status === 0 && out.trim().length > 0;
  return { path: lockPath, stale: size === 0 && !liveGit, size };
}

/**
 * Resolve absolute git-common-dir for cwd.
 * @param {string} cwd
 */
export function resolveGitCommonDir(cwd) {
  const r = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.status !== 0) return null;
  return (r.stdout || "").trim() || null;
}

/**
 * Ensure the repository is not shallow. Clears a stale shallow.lock first.
 * Writes both stdout and stderr so gate log capture cannot lose the diagnosis.
 *
 * @param {{
 *   cwd: string,
 *   fetch?: boolean,
 *   remote?: string,
 *   log?: (line: string) => void,
 * }} opts
 * @returns {{
 *   wasShallow: boolean,
 *   unshallowed: boolean,
 *   ok: boolean,
 *   message: string,
 *   clearedStaleLock: boolean,
 * }}
 */
export function ensureFullHistory(opts) {
  const cwd = opts.cwd;
  const remote = opts.remote ?? "origin";
  const fetch = opts.fetch !== false;
  const log =
    opts.log ??
    ((line) => {
      process.stdout.write(`${line}\n`);
      process.stderr.write(`${line}\n`);
    });

  const gitDir = resolveGitCommonDir(cwd);
  let clearedStaleLock = false;
  if (gitDir) {
    const lock = inspectShallowLock(gitDir);
    if (lock?.stale) {
      try {
        unlinkSync(lock.path);
        clearedStaleLock = true;
        log(
          `git-shallow-preflight: removed stale empty shallow.lock at ${lock.path} (BI-8304AB09 — crashed git debris)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          wasShallow: true,
          unshallowed: false,
          ok: false,
          clearedStaleLock: false,
          message:
            `clone appears blocked by shallow.lock at ${lock.path} but could not remove it: ${msg}. ` +
            `Delete the lock file manually, then run: git fetch --unshallow ${remote}`,
        };
      }
    } else if (lock && !lock.stale) {
      return {
        wasShallow: true,
        unshallowed: false,
        ok: false,
        clearedStaleLock: false,
        message:
          `git shallow.lock is present at ${lock.path} (size=${lock.size}) and a git process may still be live. ` +
          `Wait for it to finish, or if stuck, stop git and remove the lock, then: git fetch --unshallow ${remote}`,
      };
    }
  }

  const shallow = git(cwd, ["rev-parse", "--is-shallow-repository"]);
  const isShallow = shallow.status === 0 && (shallow.stdout || "").trim() === "true";
  if (!isShallow) {
    return {
      wasShallow: false,
      unshallowed: false,
      ok: true,
      clearedStaleLock,
      message: "repository has full history",
    };
  }

  log(
    "git-shallow-preflight: this clone is SHALLOW — three-dot diffs and merge-base will lie " +
      '("no merge base" / "unrelated histories"). Fetching full history (BI-8304AB09 / BI-AA2201B0).',
  );

  if (!fetch) {
    return {
      wasShallow: true,
      unshallowed: false,
      ok: false,
      clearedStaleLock,
      message:
        "repository is shallow. Run: git fetch --unshallow origin   " +
        "(if that fails on shallow.lock, delete .git/shallow.lock when no git process is running)",
    };
  }

  const unshallow = git(cwd, ["fetch", "--unshallow", remote]);
  if (unshallow.status !== 0) {
    const detail = (unshallow.stderr || unshallow.stdout || "").trim();
    return {
      wasShallow: true,
      unshallowed: false,
      ok: false,
      clearedStaleLock,
      message:
        `failed to unshallow at ${cwd}: ${detail || "git fetch --unshallow failed"}. ` +
        `If the error mentions shallow.lock, remove a stale empty .git/shallow.lock when no git is running, then retry.`,
    };
  }

  log("git-shallow-preflight: unshallow complete — merge-base and three-dot diffs are trustworthy again.");
  return {
    wasShallow: true,
    unshallowed: true,
    ok: true,
    clearedStaleLock,
    message: "unshallowed successfully",
  };
}

// CLI: node scripts/lib/git-shallow-preflight.mjs [cwd]
const invoked =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("git-shallow-preflight.mjs");
if (invoked) {
  const cwd = process.argv[2] || process.cwd();
  const result = ensureFullHistory({ cwd, fetch: true });
  if (!result.ok) {
    process.stderr.write(`git-shallow-preflight: FAIL — ${result.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`git-shallow-preflight: OK — ${result.message}\n`);
}
