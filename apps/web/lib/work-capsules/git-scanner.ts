import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";

const { execFile } = lazyChildProcess();
const { promisify } = lazyUtil();
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

export function parseBranchList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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

export async function listLocalBranches(repoRoot: string): Promise<Set<string>> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, "branch", "--format=%(refname:short)"], {
    timeout: 5000,
    windowsHide: true,
  });
  return new Set(parseBranchList(stdout));
}

export async function getWorktreeDirtySummary(worktreePath: string): Promise<GitDirtySummary> {
  const { stdout } = await execFileAsync("git", ["-C", worktreePath, "status", "--porcelain"], {
    timeout: 5000,
    windowsHide: true,
  });
  return parseGitStatusPorcelain(stdout);
}

/**
 * True when the trunk ref (default `origin/main`) resolves in this local repo —
 * i.e. reachability checks here are meaningful. False when there is no local git
 * repo, no fetched trunk, or git is unavailable (the portal-runtime case), so a
 * caller can skip a whole batch of {@link isReachableFromTrunk} calls rather than
 * fan out hundreds of failing spawns.
 */
export async function trunkRefExists(repoRoot: string, trunkRef = "origin/main"): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${trunkRef}^{commit}`], {
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `headSha` is an ancestor of the trunk (`git merge-base --is-ancestor`
 * exits 0) — i.e. the branch's work has landed and the room is DELIVERED. This is
 * the workroom-closeout "done" signal, computed PROCEDURALLY from the LOCAL repo:
 * no GitHub PR API, no LLM, and it still answers when the network / external
 * providers are down. Returns null when it cannot decide (missing sha, sha not
 * fetched locally, or git error) so the caller withholds the delivered verdict
 * rather than guessing. Reads objects only — never touches a worktree.
 */
/**
 * True when the trunk carries the squash/merge commit of pull request
 * `prNumber` — the subject GitHub writes is "<title> (#N)". This is the
 * delivery signal for work that landed WITHOUT a Workroom recording its head
 * (BI-AFE8BB73, design §4 "delivery evidence is the trunk, not a manifest"):
 * the item's linked PR, resolved procedurally from the local clone, no API.
 * `null` when git cannot answer (no clone, no trunk), never a false "merged".
 */
export async function trunkHasMergedPullRequest(
  repoRoot: string,
  prNumber: number | null | undefined,
  trunkRef = "origin/main",
): Promise<boolean | null> {
  if (!prNumber || !Number.isInteger(prNumber) || prNumber <= 0) return null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoRoot, "log", trunkRef, "--fixed-strings", `--grep=(#${prNumber})`, "-1", "--format=%H"],
      { timeout: 5000, windowsHide: true },
    );
    return stdout.trim().length > 0;
  } catch {
    return null;
  }
}

export async function isReachableFromTrunk(
  repoRoot: string,
  headSha: string | null | undefined,
  trunkRef = "origin/main",
): Promise<boolean | null> {
  if (!headSha) return null;
  try {
    await execFileAsync(
      "git",
      ["-C", repoRoot, "merge-base", "--is-ancestor", headSha, trunkRef],
      { timeout: 5000, windowsHide: true },
    );
    return true; // exit 0 → headSha is reachable from trunk (merged)
  } catch (err) {
    // exit 1 → definitively NOT an ancestor (unmerged). Any other failure
    // (unknown sha, bad ref, git missing) → indeterminate, withhold judgment.
    const code = (err as { code?: number } | null)?.code;
    if (code === 1) return false;
    return null;
  }
}
