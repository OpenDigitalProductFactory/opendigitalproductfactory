// scripts/lib/dco-signoff.mjs — shared Developer Certificate of Origin (DCO)
// sign-off predicate and commit-range scanner.
//
// THE PROBLEM: the "DCO" required check on a DPF pull request is posted by the
// third-party DCO GitHub App AFTER a push, as a commit status. A branch whose
// history contains an unsigned commit — classically an auto-generated or
// corrupted MERGE commit (PR #4189 pushed exactly that) — is only discovered to
// be red once CI runs, long after the author has moved on. The per-commit
// predicate already lived inline in scripts/pr-readiness/core.mjs; this module
// hoists it so `pnpm pr:ready` (pre-PR) and the pre-push git hook agree
// bit-for-bit, and so the pre-push gate can refuse an unsigned push locally.
//
// This module imports nothing from the monorepo graph and shells out to git
// only through an injectable executor, so it runs in a source-only worktree and
// in the pre-push gate's temp-dir contract tests without a bootstrap install.

import { spawnSync } from "node:child_process";

// The DCO app requires the commit author's own identity, not merely any
// Signed-off-by trailer. Multiple sign-offs are valid, but one must exactly
// match Git's `%an <%ae>` for this commit. Keep keyword matching
// case-insensitive while preserving identity bytes: changing an email's case or
// spelling is a different author as far as the commit payload is concerned.
const SIGNED_OFF_LINE = /^[ \t]*Signed-off-by:[ \t]*(\S.*?)[ \t]*$/gim;

export function isSignedOff(body, { authorName, authorEmail } = {}) {
  const name = String(authorName ?? "").trim();
  const email = String(authorEmail ?? "").trim();
  if (!name || !email) return false;
  const expected = `${name} <${email}>`;
  return [...String(body ?? "").matchAll(SIGNED_OFF_LINE)]
    .some((match) => match[1] === expected);
}

// Default git executor: returns { status, stdout, stderr }. Kept separate so
// tests can inject a fake without spawning git.
function defaultGit(args, { cwd = process.cwd() } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

// Field separator that cannot appear inside a commit subject/body (ASCII unit
// separator), used to parse `git log` records robustly — same technique as
// scripts/pr-readiness.mjs readCommits().
const US = "\x1f";
// Record separator between commits.
const RS = "\x1e";

/**
 * Scan a commit range for commits missing a DCO sign-off.
 *
 * @param {string} range - a git revision range, e.g. "origin/main..HEAD". When
 *   empty/falsey, no commits are scanned (returns []).
 * @param {object}  opts
 * @param {(args:string[],o?:object)=>{status:number,stdout:string,stderr:string,error?:Error}} [opts.git]
 * @param {string}  [opts.cwd]
 * @returns {{ sha:string, subject:string, body:string }[]} unsigned commits, in
 *   `git log` order (newest first). MERGE commits are included — the range is
 *   scanned with default `git log` semantics, not `--no-merges`, because an
 *   unsigned merge is exactly the case that must be caught.
 * @throws {Error} when git cannot enumerate the range (missing base ref, not a
 *   repo). Callers decide whether an un-enumerable range is fatal or a warn.
 */
export function findUnsignedCommits(range, { git = defaultGit, cwd } = {}) {
  if (!range) return [];
  const format = ["%H", "%s", "%an", "%ae", "%b"].join(US);
  const result = git(
    ["log", `--pretty=format:${format}${RS}`, range],
    { cwd },
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || "").trim() || `git log ${range} failed (status ${result.status})`,
    );
  }
  const raw = String(result.stdout ?? "");
  const commits = raw
    .split(RS)
    .map((entry) => entry.replace(/^\n/, ""))
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => {
      const [sha = "", subject = "", authorName = "", authorEmail = "", ...bodyParts] = entry.split(US);
      return { sha, subject, authorName, authorEmail, body: bodyParts.join(US) };
    });
  // A commit's full message = subject + body; `git log %s%b` splits them, so a
  // trailer on the subject line (rare) or in the body both satisfy the check.
  return commits.filter((commit) => !isSignedOff(
    `${commit.subject}\n${commit.body}`,
    { authorName: commit.authorName, authorEmail: commit.authorEmail },
  ));
}

/**
 * Resolve the range to scan for a push. Prefers an explicit range; otherwise
 * computes `<base>..HEAD` — the PR payload — after confirming the base ref
 * resolves. Returns { range, baseResolved }.
 *
 * @param {object} opts
 * @param {string} [opts.explicitRange]
 * @param {string} [opts.baseRef]   default "origin/main"
 * @param {string} [opts.head]      default "HEAD"
 */
export function resolvePushRange({
  explicitRange,
  baseRef = "origin/main",
  head = "HEAD",
  git = defaultGit,
  cwd,
} = {}) {
  if (explicitRange) return { range: explicitRange, baseResolved: true };
  const verify = git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], { cwd });
  const baseResolved = !verify.error && verify.status === 0;
  if (!baseResolved) return { range: null, baseResolved: false };
  return { range: `${baseRef}..${head}`, baseResolved: true };
}
