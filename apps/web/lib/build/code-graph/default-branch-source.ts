// Index the DEFAULT BRANCH, not whatever the host checkout happens to be on.
//
// BI-86EF5900 acceptance criterion 1: "The index is built from the default
// branch, and lastIndexedBranch proves it."
//
// The indexer read `PROJECT_ROOT`'s working tree directly, so the graph
// described whichever branch that checkout sat on. On the live install
// PROJECT_ROOT is /sandbox-workspace — a Build Studio sandbox parked on
// `client/5727856b-…` — so a fully healthy graph (47,544 nodes, 56,593 edges)
// still answered "no" for MileageRate, a model that is on main. The graph
// exists to answer "what breaks if I change this" against the MERGE TARGET;
// pointing it at a sandbox branch makes every answer quietly off-target.
//
// Rather than repoint PROJECT_ROOT — which is also read by
// describe_committed_model, read_project_file and other consumers, so moving it
// changes what they all see — this resolves the default-branch ref and checks
// it out into a dedicated linked worktree that only the indexer uses. The whole
// existing read path (listTrackedFiles, readFile, the extractors) is reused
// unchanged against that path. Kernel decision DI-B0BE15B52C46.

import { lazyExec, lazyPath } from "@/lib/shared/lazy-node";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const exec = lazyExec();

/** Preference order for "the tree everyone merges into". */
const DEFAULT_BRANCH_CANDIDATES = ["origin/main", "origin/master", "main", "master"] as const;

/** Directory name of the indexer-owned worktree, kept beside the host checkout. */
export const CODE_GRAPH_WORKTREE_DIRNAME = ".dpf-code-graph-default-branch";

function gitIn(root: string, args: string): string {
  return `git -c safe.directory=${JSON.stringify(root)} ${args}`;
}

async function tryGit(root: string, args: string, timeout = 20_000): Promise<string | null> {
  try {
    const { stdout } = await exec(gitIn(root, args), { cwd: root, timeout });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export type DefaultBranchRef = {
  /** Ref that resolved, e.g. "origin/main". */
  ref: string;
  /** Branch label to record, e.g. "main" — what lastIndexedBranch should say. */
  branch: string;
  /** Commit the ref points at. */
  sha: string;
};

/**
 * Resolve the default-branch ref inside `gitRoot`. Returns null when none of
 * the candidates exist — a repository with no main/master is a legitimate
 * state, and the caller falls back to the working tree rather than failing.
 */
export async function resolveDefaultBranchRef(gitRoot: string): Promise<DefaultBranchRef | null> {
  for (const ref of DEFAULT_BRANCH_CANDIDATES) {
    const sha = await tryGit(gitRoot, `rev-parse --verify ${ref}`);
    if (sha) {
      return { ref, branch: ref.replace(/^origin\//, ""), sha };
    }
  }
  return null;
}

export type DefaultBranchWorktree = {
  path: string;
  branch: string;
  sha: string;
};

/**
 * Ensure a linked worktree pinned at `target.sha`, and return its path.
 *
 * Created once and then fast-forwarded in place — a fresh checkout of ~13k
 * files every 15 minutes would be wasteful, and `reset --hard` to an already
 * matching sha is a no-op. Returns null when the worktree cannot be prepared;
 * the caller then indexes the working tree and records THAT branch, so a
 * failure here degrades to the previous behaviour rather than to no graph.
 */
export async function ensureDefaultBranchWorktree(
  gitRoot: string,
  target: DefaultBranchRef,
): Promise<{ worktree: DefaultBranchWorktree | null; warning: string | null }> {
  const { resolve } = lazyPath();
  const path = resolve(gitRoot, CODE_GRAPH_WORKTREE_DIRNAME);

  const head = await tryGit(path, "rev-parse HEAD", 10_000);
  if (head === null) {
    // No usable worktree yet. --force tolerates a stale registration left by a
    // killed run; a detached checkout keeps it off the branch namespace so it
    // can never be confused for someone's working branch.
    const added = await tryGit(
      gitRoot,
      `worktree add --detach --force ${JSON.stringify(path)} ${target.sha}`,
      120_000,
    );
    if (added === null) {
      const detail = await tryGit(gitRoot, "worktree list", 10_000);
      return {
        worktree: null,
        warning:
          `Could not prepare the default-branch worktree at ${path}; indexing the host working tree instead. ` +
          `Existing worktrees: ${detail ?? "(unreadable)"}`,
      };
    }
    return { worktree: { path, branch: target.branch, sha: target.sha }, warning: null };
  }

  if (head === target.sha) {
    return { worktree: { path, branch: target.branch, sha: target.sha }, warning: null };
  }

  const reset = await tryGit(path, `reset --hard ${target.sha}`, 120_000);
  if (reset === null) {
    return {
      worktree: null,
      warning:
        `Default-branch worktree at ${path} is on ${head} and could not be moved to ${target.sha}; ` +
        "indexing the host working tree instead.",
    };
  }
  return { worktree: { path, branch: target.branch, sha: target.sha }, warning: null };
}

/**
 * Full resolution: which path should the indexer read, and what branch/sha
 * should it record? Falls back to the host working tree, with a warning, so a
 * default-branch problem never costs the graph entirely.
 */
export async function resolveIndexSource(gitRoot: string): Promise<{
  root: string;
  branch: string | null;
  sha: string | null;
  usedDefaultBranch: boolean;
  warning: string | null;
}> {
  try {
    const target = await resolveDefaultBranchRef(gitRoot);
    if (!target) {
      return {
        root: gitRoot,
        branch: null,
        sha: null,
        usedDefaultBranch: false,
        warning:
          "No default branch (origin/main, origin/master, main, master) resolved in this repository; " +
          "indexed the host working tree, so the graph describes whatever it is checked out on.",
      };
    }
    const { worktree, warning } = await ensureDefaultBranchWorktree(gitRoot, target);
    if (!worktree) {
      return { root: gitRoot, branch: null, sha: null, usedDefaultBranch: false, warning };
    }
    return {
      root: worktree.path,
      branch: worktree.branch,
      sha: worktree.sha,
      usedDefaultBranch: true,
      warning: null,
    };
  } catch (error) {
    return {
      root: gitRoot,
      branch: null,
      sha: null,
      usedDefaultBranch: false,
      warning: `Default-branch resolution failed (${getErrorMessage(error)}); indexed the host working tree.`,
    };
  }
}
