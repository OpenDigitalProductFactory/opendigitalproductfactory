import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RECENT_BRANCH_DAYS = 45;

export type WorktreeInfo = {
  path: string;
  headSha: string | null;
  branch: string | null;
};

export type GitDirtySummary = {
  modifiedCount: number;
  untrackedCount: number;
};

export type AdoptableBranchDecision = {
  hasOpenPr: boolean;
  dirtyCount: number;
  aheadCount: number;
  lastCommitAt: Date | null;
  now: Date;
};

export function parseGitStatusPorcelain(output: string): GitDirtySummary {
  let modifiedCount = 0;
  let untrackedCount = 0;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("??")) untrackedCount += 1;
    else modifiedCount += 1;
  }

  return { modifiedCount, untrackedCount };
}

export function parseWorktreeList(output: string): WorktreeInfo[] {
  const records = output
    .split(/\r?\n\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return records
    .map((record) => {
      const row: WorktreeInfo = { path: "", headSha: null, branch: null };
      for (const line of record.split(/\r?\n/)) {
        if (line.startsWith("worktree ")) row.path = line.slice("worktree ".length).trim();
        if (line.startsWith("HEAD ")) row.headSha = line.slice("HEAD ".length).trim();
        if (line.startsWith("branch refs/heads/")) {
          row.branch = line.slice("branch refs/heads/".length).trim();
        }
      }
      return row;
    })
    .filter((row) => row.path.length > 0);
}

export function parsePrUrlFromText(text: string | null | undefined): string | null {
  const match = text?.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/);
  return match?.[0] ?? null;
}

export function shouldSurfaceAdoptableBranch(input: AdoptableBranchDecision): boolean {
  if (input.hasOpenPr) return true;
  if (input.dirtyCount > 0) return true;
  if (input.aheadCount <= 0 || !input.lastCommitAt) return false;

  const ageMs = input.now.getTime() - input.lastCommitAt.getTime();
  return ageMs <= RECENT_BRANCH_DAYS * 24 * 60 * 60 * 1000;
}

export async function scanGitWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], {
    timeout: 5000,
    windowsHide: true,
  });
  return parseWorktreeList(stdout);
}

export async function getWorktreeDirtySummary(worktreePath: string): Promise<GitDirtySummary> {
  const { stdout } = await execFileAsync("git", ["-C", worktreePath, "status", "--porcelain"], {
    timeout: 5000,
    windowsHide: true,
  });
  return parseGitStatusPorcelain(stdout);
}
