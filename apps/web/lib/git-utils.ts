// apps/web/lib/git-utils.ts
// Async git operations for the development lifecycle pipeline.

import { exec as execCb } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import { isPathAllowed, isDevInstance } from "@/lib/codebase-tools";

const exec = promisify(execCb);
const PROJECT_ROOT = resolve(process.cwd(), "..", "..");
const GIT_TIMEOUT_MS = 10_000;

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
    await exec("git rev-parse --git-dir", { cwd: PROJECT_ROOT, timeout: 2000 });
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
    await exec(`git add ${JSON.stringify(opts.filePath)}`, { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
    await exec(`git commit -m ${JSON.stringify(opts.message)}`, { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
    const { stdout } = await exec("git rev-parse HEAD", { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
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
    await exec(`git tag -a ${JSON.stringify(opts.tag)} -m ${JSON.stringify(opts.message)}`, { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git tag failed" };
  }
}

export async function getCurrentCommitHash(): Promise<string | null> {
  try {
    const { stdout } = await exec("git rev-parse HEAD", { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
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
      { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS },
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
      { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS },
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
      { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
