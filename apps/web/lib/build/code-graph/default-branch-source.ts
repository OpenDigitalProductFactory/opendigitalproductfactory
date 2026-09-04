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

import { lazyExec, lazyPath, lazyFsPromises, lazyOs } from "@/lib/shared/lazy-node";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const exec = lazyExec();

/** Preference order for "the tree everyone merges into". */
const DEFAULT_BRANCH_CANDIDATES = ["origin/main", "origin/master", "main", "master"] as const;

/** Directory name of the indexer-owned worktree. */
export const CODE_GRAPH_WORKTREE_DIRNAME = "dpf-code-graph-default-branch";

/**
 * Where the indexer-owned worktree lives.
 *
 * NOT inside the host checkout. The first version put it at
 * `<gitRoot>/.dpf-code-graph-default-branch`, which on the live install meant
 * dropping a 101-entry root-owned checkout INSIDE /sandbox-workspace — the tree
 * Build Studio actually builds in. A private scratch checkout has no business
 * living in someone else's working tree.
 *
 * Outside the repo it is also out of reach of the repo-scanning tooling that
 * prunes stale worktree registrations, which is what orphaned the first one.
 * Override with DPF_CODE_GRAPH_WORKTREE_DIR when tmp is unsuitable.
 */
export function codeGraphWorktreePath(): string {
  const { resolve } = lazyPath();
  const override = process.env.DPF_CODE_GRAPH_WORKTREE_DIR;
  if (override) return resolve(override);
  return resolve(lazyOs().tmpdir(), CODE_GRAPH_WORKTREE_DIRNAME);
}

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

/**
 * Delete a leftover indexer worktree directory so `worktree add` can recreate
 * it. Deliberately narrow: it refuses any path that is not our own
 * deterministically named scratch directory, because this is the one operation
 * here that destroys data and it must never be pointed at a real checkout.
 */
async function removeLeftoverWorktreeDir(path: string): Promise<void> {
  const { basename } = lazyPath();
  if (basename(path) !== CODE_GRAPH_WORKTREE_DIRNAME) return;
  try {
    await lazyFsPromises().rm(path, { recursive: true, force: true });
  } catch {
    // Leave it; `worktree add` will report the real reason and the caller
    // degrades to the host tree with that reason logged.
  }
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
  const path = codeGraphWorktreePath();

  const head = await tryGit(path, "rev-parse HEAD", 10_000);
  if (head === null) {
    // No USABLE worktree — but the directory may still be sitting there.
    //
    // Observed live: the first run checked out 101 entries successfully, then
    // something ran `git worktree prune` and dropped the registration, leaving
    // an orphaned directory. Every later run failed with
    // "fatal: '<path>' already exists", because `--force` overrides a stale
    // REGISTRATION, not a leftover DIRECTORY. Recover from both.
    await tryGit(gitRoot, "worktree prune", 30_000);
    await removeLeftoverWorktreeDir(path);

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
