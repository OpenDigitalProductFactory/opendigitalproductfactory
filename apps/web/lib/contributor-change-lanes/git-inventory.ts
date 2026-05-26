import type { GitBranchSnapshot, GitWorktreeSnapshot } from "./types";

const ORIGIN_PREFIX = "refs/remotes/origin/";
const SHORT_ORIGIN_PREFIX = "origin/";

export type GitInventoryError = {
  source: "worktree" | "branch";
  message: string;
};

export type GitInventoryResult = {
  worktrees: GitWorktreeSnapshot[];
  branches: GitBranchSnapshot[];
  errors: GitInventoryError[];
};

export function parseGitWorktreeList(porcelain: string): GitWorktreeSnapshot[] {
  if (!porcelain.trim()) return [];

  const blocks = porcelain.split(/\r?\n\r?\n/);
  const out: GitWorktreeSnapshot[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    let path: string | null = null;
    let head: string | null = null;
    let branch: string | null = null;
    let detached = false;
    let bare = false;

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length).trim();
      else if (line.startsWith("branch ")) {
        const raw = line.slice("branch ".length).trim();
        branch = raw.startsWith("refs/heads/") ? raw.slice("refs/heads/".length) : raw;
      } else if (line === "detached") detached = true;
      else if (line === "bare") bare = true;
    }

    if (!path || bare) continue;
    out.push({
      path: normalizePath(path),
      branch: detached ? null : branch,
      headSha: head,
      isRegistered: true,
    });
  }

  return out;
}

export function parseGitBranchList(
  forEachRefOutput: string,
  options?: { remote?: "origin" | "local"; now?: Date },
): GitBranchSnapshot[] {
  if (!forEachRefOutput.trim()) return [];
  const remote = options?.remote ?? "origin";
  const out: GitBranchSnapshot[] = [];

  for (const line of forEachRefOutput.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const [refname, sha, lastCommitRaw, mergedRaw] = parts;
    const name = normalizeBranchName(refname ?? "");
    if (!name) continue;
    if (name === "HEAD") continue;

    const lastCommitAt = lastCommitRaw ? parseGitDate(lastCommitRaw) : null;
    const isMerged = (mergedRaw ?? "").trim() === "merged";

    out.push({
      name,
      headSha: sha ?? null,
      remote,
      isMerged,
      lastCommitAt,
    });
  }

  return out;
}

export function mergeFilesystemAndRegisteredWorktrees(
  registered: GitWorktreeSnapshot[],
  filesystemPaths: string[],
): GitWorktreeSnapshot[] {
  const known = new Set(registered.map((wt) => normalizePath(wt.path)));
  const additions: GitWorktreeSnapshot[] = [];
  for (const raw of filesystemPaths) {
    const path = normalizePath(raw);
    if (known.has(path)) continue;
    additions.push({
      path,
      branch: null,
      headSha: null,
      isRegistered: false,
    });
  }
  return [...registered, ...additions];
}

function normalizeBranchName(refname: string): string {
  if (refname.startsWith(ORIGIN_PREFIX)) return refname.slice(ORIGIN_PREFIX.length);
  if (refname.startsWith(SHORT_ORIGIN_PREFIX)) return refname.slice(SHORT_ORIGIN_PREFIX.length);
  if (refname.startsWith("refs/heads/")) return refname.slice("refs/heads/".length);
  return refname;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function parseGitDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
