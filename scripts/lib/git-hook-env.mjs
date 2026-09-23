// scripts/lib/git-hook-env.mjs — strip git's repository-locating variables
// from an environment before spawning anything that builds its OWN git
// repository (BI-062F5687).
//
// When git runs a hook from a LINKED worktree it exports GIT_DIR (pointing at
// <root>/.git/worktrees/<name>) into the hook's environment; from the main
// clone it does not. Any child that inherits that environment and then runs
// `git init`/`clone`/`add -A`/`commit` inside a temp directory is no longer
// talking to its fixture: with GIT_DIR set and GIT_WORK_TREE unset, git treats
// the child's cwd as the work tree of the REAL repository. A guard-run test
// fixture did exactly that under `git push` and committed a 15,511-file
// deletion to the pushing branch. Standalone runs were clean because a normal
// shell carries none of these variables — the defect was only ever reachable
// through the hook environment.
//
// Two call sites share this one rule: the preflight runner scrubs the
// environment it hands every guard (so no future fixture can repeat the
// deletion), and test fixtures that create temp repositories scrub the
// environment they hand git (so they are correct even when run some other
// way under a hook).

/**
 * Variables that tell git WHERE the repository is, as opposed to who is
 * committing or how to behave. Author/committer identity, GIT_EDITOR,
 * GIT_EXEC_PATH, GIT_CONFIG_* and the trace family are deliberately kept.
 */
export const GIT_REPO_LOCATION_ENV = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
]);

/**
 * Returns a copy of `env` with every repository-locating git variable removed.
 * The input is never mutated. Pass the result as the `env` of any spawn that
 * must resolve its repository from its own cwd.
 */
export function scrubGitRepoLocationEnv(env = process.env) {
  const scrubbed = { ...env };
  for (const name of GIT_REPO_LOCATION_ENV) delete scrubbed[name];
  return scrubbed;
}
