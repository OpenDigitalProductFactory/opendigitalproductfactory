// apps/web/lib/git-utils.ts
// Async git operations for the development lifecycle pipeline.

import { exec as execCb } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import { isPathAllowedSync as isPathAllowed, isDevInstance } from "@/lib/codebase-tools";

const exec = promisify(execCb);
const GIT_TIMEOUT_MS = 10_000;

/** Resolve git root at call time — respects PROJECT_ROOT env var set by Docker. */
function getGitRoot(): string {
  return process.env.PROJECT_ROOT
    ? resolve(process.env.PROJECT_ROOT)
    : resolve(process.cwd(), "..", "..");
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Git ref names must be alphanumeric with . _ / - only. Prevents shell injection. */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9._\/-]+$/;

function isSafeRef(ref: string): boolean {
  return SAFE_REF_PATTERN.test(ref) && ref.length < 256;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMMIT_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\bfix(e[sd])?\b/i, "fix"],
  [/\brefactor/i, "refactor"],
  [/\bdoc(s|ument)?\b/i, "docs"],
  [/\bchore\b/i, "chore"],
];

export function inferCommitType(description: string): string {
  for (const [pattern, type] of COMMIT_TYPE_PATTERNS) {
    if (pattern.test(description)) return type;
  }
  return "feat";
}

export function inferModule(filePath: string): string {
  if (filePath.startsWith("apps/web/lib/")) return "web-lib";
  if (filePath.startsWith("apps/web/app/")) return "web-app";
  if (filePath.startsWith("apps/web/components/")) return "web-components";
  if (filePath.startsWith("apps/web/")) return "web";
  if (filePath.startsWith("packages/db/")) return "db";
  if (filePath.startsWith("packages/")) return "packages";
  if (filePath.startsWith("scripts/")) return "scripts";
  return "root";
}

export function formatCommitMessage(opts: {
  description: string;
  filePath: string;
  buildId?: string;
  approvedBy: string;
  proposalId?: string;
}): string {
  const type = inferCommitType(opts.description);
  const module = inferModule(opts.filePath);
  const subject = `${type}(${module}): ${opts.description}`;
  const trailers = [
    "",
    `Build: ${opts.buildId ?? "standalone"}`,
    `Approved-By: ${opts.approvedBy}`,
    `Change-Type: ai-proposed`,
  ];
  if (opts.proposalId) trailers.push(`Proposal: ${opts.proposalId}`);
  return subject + "\n" + trailers.join("\n");
}

// ─── Git Availability ────────────────────────────────────────────────────────

export async function isGitAvailable(): Promise<boolean> {
  try {
    await exec("git rev-parse --git-dir", { cwd: getGitRoot(), timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Git Operations ──────────────────────────────────────────────────────────

export async function commitFile(opts: {
  filePath: string;  // Must be project-root-relative
  message: string;
}): Promise<{ hash: string } | { error: string }> {
  if (!isDevInstance()) return { error: "Git commits are only available on dev instances." };
  if (!isPathAllowed(opts.filePath)) {
    return { error: `Path not allowed for commit: ${opts.filePath}` };
  }
  try {
    await exec(`git add ${JSON.stringify(opts.filePath)}`, { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS });
    await exec(`git commit -m ${JSON.stringify(opts.message)}`, { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS });
    const { stdout } = await exec("git rev-parse HEAD", { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS });
    return { hash: stdout.trim() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git commit failed" };
  }
}

export async function createTag(opts: {
  tag: string;
  message: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isDevInstance()) return { error: "Git tags are only available on dev instances." };
  if (!isSafeRef(opts.tag)) return { error: `Invalid tag name: ${opts.tag}` };
  try {
    await exec(`git tag -a ${JSON.stringify(opts.tag)} -m ${JSON.stringify(opts.message)}`, { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git tag failed" };
  }
}

export async function getCurrentCommitHash(): Promise<string | null> {
  try {
    const { stdout } = await exec("git rev-parse HEAD", { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function gitLog(opts?: {
  from?: string;
  to?: string;
  maxCount?: number;
}): Promise<{ commits: Array<{ hash: string; message: string; date: string }> }> {
  try {
    // Validate refs to prevent shell injection
    if (opts?.from && !isSafeRef(opts.from)) return { commits: [] };
    if (opts?.to && !isSafeRef(opts.to)) return { commits: [] };

    const range = opts?.from && opts?.to ? `${opts.from}..${opts.to}` : "";
    const limit = opts?.maxCount ? `--max-count=${opts.maxCount}` : "--max-count=50";
    // Use %x00 (null byte) delimiter to safely handle quotes in commit messages
    const format = "--format=%H%x00%s%x00%aI";
    const { stdout } = await exec(
      `git log ${limit} ${format} ${range}`.trim(),
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    const commits: Array<{ hash: string; message: string; date: string }> = [];
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const parts = line.split("\0");
      if (parts.length >= 3) {
        commits.push({ hash: parts[0]!, message: parts[1]!, date: parts[2]! });
      }
    }
    return { commits };
  } catch {
    return { commits: [] };
  }
}

export async function getCommitCount(from: string, to: string = "HEAD"): Promise<number> {
  if (!isSafeRef(from) || !isSafeRef(to)) return 0;
  try {
    const { stdout } = await exec(
      `git rev-list --count ${from}..${to}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export async function getLatestTag(): Promise<string | null> {
  try {
    const { stdout } = await exec(
      "git describe --tags --abbrev=0",
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// ─── Production Read-Only Git Operations ─────────────────────────────────────
// These functions work with a read-only .git mount in production.
// They do NOT require isDevInstance() — that's the point.

export async function gitShow(opts: {
  ref: string;
  path: string;
}): Promise<{ content: string } | { error: string }> {
  if (!isSafeRef(opts.ref)) return { error: `Invalid ref: ${opts.ref}` };
  if (!isPathAllowed(opts.path)) return { error: `Path not allowed: ${opts.path}` };
  try {
    const { stdout } = await exec(
      `git show ${JSON.stringify(opts.ref + ":" + opts.path)}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    return { content: stdout };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "git show failed" };
  }
}

export async function gitDiffStat(opts: {
  from: string;
  to: string;
}): Promise<{ filesChanged: number; summary: string }> {
  if (!isSafeRef(opts.from) || !isSafeRef(opts.to)) return { filesChanged: 0, summary: "Invalid refs" };
  try {
    const { stdout: stat } = await exec(
      `git diff --stat ${opts.from}..${opts.to}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    const { stdout: shortlog } = await exec(
      `git log --oneline ${opts.from}..${opts.to}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    const filesChanged = (stat.match(/\d+ files? changed/) || ["0"])[0]
      .replace(/ files? changed/, "")
      .trim();
    return {
      filesChanged: parseInt(filesChanged, 10) || 0,
      summary: `${stat.trim()}\n\nCommits:\n${shortlog.trim()}`,
    };
  } catch {
    return { filesChanged: 0, summary: "Could not compute diff" };
  }
}

export async function gitGrep(opts: {
  query: string;
  ref: string;
  glob?: string;
  maxResults?: number;
}): Promise<{ results: Array<{ path: string; line: number; text: string }> }> {
  if (!isSafeRef(opts.ref)) return { results: [] };
  const max = opts.maxResults ?? 20;
  try {
    const globArg = opts.glob ? `-- ${JSON.stringify(opts.glob)}` : "";
    const { stdout } = await exec(
      `git grep -n --max-count=${max} ${JSON.stringify(opts.query)} ${opts.ref} ${globArg}`.trim(),
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    const results: Array<{ path: string; line: number; text: string }> = [];
    for (const line of stdout.split("\n").slice(0, max)) {
      // Format: ref:path:linenum:text
      const match = line.match(/^[^:]+:(.+?):(\d+):(.*)$/);
      if (match) {
        const [, path, lineNum, text] = match;
        if (path && lineNum && isPathAllowed(path)) {
          results.push({ path, line: parseInt(lineNum, 10), text: text?.trim() ?? "" });
        }
      }
    }
    return { results };
  } catch {
    return { results: [] };
  }
}

// ─── Remote Git Operations (EP-BUILD-HANDOFF-002 Phase 2e) ──────────────────
// These are used by the PR-based contribution pipeline to push feature branches
// and interact with the git remote. They require isDevInstance().

/**
 * Check if a git remote is configured (typically "origin").
 */
export async function hasGitRemote(remote: string = "origin"): Promise<boolean> {
  if (!isSafeRef(remote)) return false;
  try {
    const { stdout } = await exec(
      `git remote get-url ${remote}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the URL of a git remote.
 */
export async function getRemoteUrl(remote: string = "origin"): Promise<string | null> {
  if (!isSafeRef(remote)) return null;
  try {
    const { stdout } = await exec(
      `git remote get-url ${remote}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Create a new git branch from the current HEAD.
 */
export async function createBranch(branchName: string): Promise<{ ok: true } | { error: string }> {
  if (!isDevInstance()) return { error: "Git branches are only available on dev instances." };
  if (!isSafeRef(branchName)) return { error: `Invalid branch name: ${branchName}` };
  try {
    await exec(
      `git checkout -b ${JSON.stringify(branchName)}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git branch creation failed" };
  }
}

/**
 * Switch to an existing git branch.
 */
export async function checkoutBranch(branchName: string): Promise<{ ok: true } | { error: string }> {
  if (!isDevInstance()) return { error: "Git checkout is only available on dev instances." };
  if (!isSafeRef(branchName)) return { error: `Invalid branch name: ${branchName}` };
  try {
    await exec(
      `git checkout ${JSON.stringify(branchName)}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git checkout failed" };
  }
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(): Promise<string | null> {
  try {
    const { stdout } = await exec(
      "git rev-parse --abbrev-ref HEAD",
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Stage all changes and create a commit. Unlike commitFile(), this stages
 * all tracked changes (not a single file).
 */
export async function commitAll(message: string): Promise<{ hash: string } | { error: string }> {
  if (!isDevInstance()) return { error: "Git commits are only available on dev instances." };
  try {
    await exec("git add -A", { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS });
    await exec(`git commit -m ${JSON.stringify(message)}`, { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS });
    const { stdout } = await exec("git rev-parse HEAD", { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS });
    return { hash: stdout.trim() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git commit failed" };
  }
}

/**
 * Push a branch to a remote. Timeout extended to 30s for network operations.
 */
export async function pushBranch(
  branchName: string,
  remote: string = "origin",
): Promise<{ ok: true } | { error: string }> {
  if (!isDevInstance()) return { error: "Git push is only available on dev instances." };
  if (!isSafeRef(branchName)) return { error: `Invalid branch name: ${branchName}` };
  if (!isSafeRef(remote)) return { error: `Invalid remote name: ${remote}` };
  try {
    await exec(
      `git push -u ${remote} ${branchName}`,
      { cwd: getGitRoot(), timeout: 30_000 },
    );
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git push failed" };
  }
}

/**
 * Apply a unified diff patch to the working tree. Used by the contribution
 * pipeline to apply sandbox diff to the feature branch.
 */
export async function applyPatch(patch: string): Promise<{ ok: true } | { error: string }> {
  if (!isDevInstance()) return { error: "Git apply is only available on dev instances." };
  const { writeFile, unlink } = await import("fs/promises");
  const tmpFile = `/tmp/dpf-pr-${Date.now()}.patch`;
  try {
    await writeFile(tmpFile, patch, "utf-8");
    await exec(
      `git apply ${JSON.stringify(tmpFile)}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git apply failed" };
  } finally {
    try { await unlink(tmpFile); } catch { /* cleanup best-effort */ }
  }
}

export async function gitLsTree(opts: {
  ref: string;
  path: string;
}): Promise<{ entries: Array<{ name: string; type: "file" | "dir"; path: string }> }> {
  if (!isSafeRef(opts.ref)) return { entries: [] };
  const safePath = opts.path === "" || opts.path === "." ? "" : opts.path;
  if (safePath && !isPathAllowed(safePath)) return { entries: [] };
  try {
    const pathArg = safePath ? ` -- ${JSON.stringify(safePath)}` : "";
    const { stdout } = await exec(
      `git ls-tree --name-only ${opts.ref}${pathArg}`,
      { cwd: getGitRoot(), timeout: GIT_TIMEOUT_MS },
    );
    const entries: Array<{ name: string; type: "file" | "dir"; path: string }> = [];
    for (const name of stdout.trim().split("\n")) {
      if (!name) continue;
      const entryPath = safePath ? `${safePath}/${name}` : name;
      if (!isPathAllowed(entryPath)) continue;
      // Check if dir by trying ls-tree on it
      entries.push({ name, type: name.includes(".") ? "file" : "dir", path: entryPath });
    }
    return { entries: entries.slice(0, 100) };
  } catch {
    return { entries: [] };
  }
}
