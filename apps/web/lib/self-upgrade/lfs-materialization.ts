// apps/web/lib/self-upgrade/lfs-materialization.ts
//
// Assert that the self-upgrade workspace holds REAL bytes for every Git
// LFS-tracked path, not pointer stubs.
//
// Why this exists (BI-FEE26C36 follow-on). The upgrade workspace is not just a
// git checkout — it is the promoter's Docker build context. `.gitattributes`
// LFS-tracks *.pdf/*.xlsx/*.docx/*.pptx, and Dockerfile COPYs one of them
// (docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx) then asserts it is a
// real zip. So an unmaterialized pointer in the workspace is not cosmetic: it
// fails the promoter build, and therefore the whole upgrade.
//
// That is exactly what happened. #4843 fixed the PUBLISH path (actions/checkout
// with `lfs: true`) and added the zip-magic assertion to Dockerfile. The
// git-source install shape has no GitHub Actions runner: it builds the same
// Dockerfile from a workspace the PORTAL container clones, and that container
// shipped without git-lfs while the git runner also forced
// GIT_LFS_SKIP_SMUDGE=1. Every scheduled upgrade after #4843 merged failed on
// the new assertion, ~2 minutes into a Docker build, with the cause visible
// only in the raw build log.
//
// Two properties this module is built for:
//
//   1. GENERIC, not per-file. Dockerfile guards the one workbook it COPYs. A
//      pointer in any other LFS-tracked path would still reach the image (or a
//      future COPY) silently. `git lfs ls-files` enumerates every tracked path
//      and states, per path, whether the object is materialized — so the check
//      covers the class, not the one instance that bit us.
//
//   2. EARLY and NAMED. Failing here costs a git command, not a two-minute
//      build, and it writes a self-describing reason onto the run row instead
//      of leaving the operator to read Docker output.
//
// Pure parsing + command builders; the caller supplies the git runner, so this
// stays unit-testable with no filesystem and no git binary.

/** One LFS-tracked path in the workspace, and whether its real bytes are present. */
export interface LfsTrackedPath {
  /** Object id as `git lfs ls-files` prints it (short oid). */
  oid: string;
  /** Repo-relative path. */
  path: string;
  /** True when the working-tree file holds the object, false when it is a pointer stub. */
  materialized: boolean;
}

/**
 * `git lfs pull` argv (without the leading "git"), matching the GitRunner
 * contract in prepare-source.ts.
 *
 * Pull rather than rely on smudge-on-checkout: the prep git runner sets
 * GIT_LFS_SKIP_SMUDGE=1 deliberately, so the mechanical branch/merge ops stay
 * fast and never block on the network mid-merge. Materialization is a single
 * explicit step once the tree is final.
 */
export function buildLfsPullCommand(workspacePath: string): string[] {
  return ["-C", workspacePath, "lfs", "pull"];
}

/** `git lfs ls-files` argv (without the leading "git"). */
export function buildLfsLsFilesCommand(workspacePath: string): string[] {
  return ["-C", workspacePath, "lfs", "ls-files"];
}

/**
 * Parse `git lfs ls-files` stdout.
 *
 * Format is `<oid> <marker> <path>`, where the marker is `*` when the object is
 * checked out into the working tree and `-` when the file is still a pointer.
 * Paths may contain spaces, so split on the first two fields only.
 *
 * Unparseable lines are ignored rather than treated as failures: this check
 * must never be the thing that blocks an otherwise-good upgrade because a
 * future git-lfs release added a column.
 */
export function parseLfsLsFiles(stdout: string): LfsTrackedPath[] {
  const out: LfsTrackedPath[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(\S+)\s+([*-])\s+(.+)$/.exec(line);
    if (!match) continue;
    out.push({ oid: match[1], materialized: match[2] === "*", path: match[3].trim() });
  }
  return out;
}

/** The LFS-tracked paths still sitting in the workspace as pointer stubs. */
export function unmaterializedPaths(tracked: LfsTrackedPath[]): string[] {
  return tracked.filter((t) => !t.materialized).map((t) => t.path);
}

/**
 * Operator-facing explanation for a workspace that still holds pointer stubs.
 * Names the cause and the two things that produce it, because both have bitten:
 * a portal image without git-lfs, and an LFS object the install clone cannot
 * reach.
 */
export function describeUnmaterialized(paths: string[]): string {
  const shown = paths.slice(0, 5).join(", ");
  const more = paths.length > 5 ? ` (+${paths.length - 5} more)` : "";
  return (
    `Git LFS objects were not materialized in the upgrade workspace: ${shown}${more}. ` +
    `The promoter builds this workspace as its Docker context and Dockerfile asserts ` +
    `real bytes, so this would fail the image build. Usual causes: the portal image is ` +
    `missing the git-lfs binary, or the LFS objects for the target commit cannot be ` +
    `fetched from the configured remote.`
  );
}
