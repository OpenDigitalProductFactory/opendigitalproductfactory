// apps/web/lib/self-upgrade/merge-point.ts
//
// Merge-point identity for the self-upgrade surface (BI-5B1FDA09).
//
// DPF ships from `main` and does not tag releases, so there is no semantic
// version to show an operator. Raw SHAs are worse than nothing here: the
// deployed id is a LOCAL MERGE COMMIT while the target is an UPSTREAM commit,
// so the two never match even when the install is current — which is why the
// banner used to carry an apologetic "the two SHAs differ by design" explainer.
//
// The honest, meaningful identity is the last merged pull request a build
// contains. Every squash-merge to `main` carries `(#1234)` in its subject, so
// one `git log -1 --format=%s <sha>` per endpoint resolves it. The subject
// parsing itself is NOT reimplemented here — it reuses the Conventional Commit
// parser the impact analyzer already relies on.
//
// Ordering note: PR numbers are LABELS, NOT ORDINALS. Merge order is a race
// (#3750 can land before #3748), so nothing here derives "newer" or "how far
// behind" from numeric PR order — those come from the commit walk
// (release-batch.ts `countPendingUpstreamCommits`).

import { parseCommit } from "./impact/conventional";

const GIT_SHA_RE = /^[0-9a-f]{40}$/i;

/** How a build is identified to an operator: last merged PR, else short SHA. */
export type MergePoint = {
  /** The full commit SHA this merge point describes. */
  sha: string;
  /** Merged PR number parsed from the commit subject; null for a direct push. */
  prNumber: number | null;
  /** Conventional-commit description with type/scope and `(#N)` stripped. */
  description: string | null;
  /** Display identity — `PR #3747` when known, else a shortened SHA. */
  label: string;
};

export type MergePointDeps = {
  execFile: (cmd: string, args: string[]) => Promise<{ stdout: string }>;
};

export type MergePointConfig = {
  hostSourcePath?: string;
};

function shortSha(sha: string): string {
  return sha.length > 12 ? `${sha.slice(0, 12)}…` : sha;
}

async function defaultExecFile(cmd: string, args: string[]): Promise<{ stdout: string }> {
  const { execFile: nodeExecFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(nodeExecFile);
  // A single subject line — 64KB is already three orders of magnitude of slack.
  const result = await execAsync(cmd, args, { maxBuffer: 64 * 1024 });
  return { stdout: result.stdout.toString() };
}

/**
 * `git -C <path> log -1 --format=%s <sha>` — the subject of one commit.
 * Pure argv builder, mirroring the command-builder style in version.ts so both
 * the resolver and its tests agree on the exact read.
 */
export function buildSubjectCommand(input: {
  hostSourcePath: string;
  sha: string;
}): string[] {
  return ["git", "-C", input.hostSourcePath, "log", "-1", "--format=%s", input.sha];
}

/**
 * Derive the merge point from a commit subject. Pure.
 *
 * A subject with no trailing `(#N)` — a direct push, or a non-squash merge —
 * degrades to the short SHA rather than rendering blank: an operator seeing
 * hex still learns more than an operator seeing nothing.
 */
export function mergePointFromSubject(sha: string, subject: string): MergePoint {
  const trimmed = subject.trim();
  if (!trimmed) {
    return { sha, prNumber: null, description: null, label: shortSha(sha) };
  }
  const parsed = parseCommit({
    sha,
    subject: trimmed,
    author: "",
    authorDate: "",
    files: [],
  });
  return {
    sha,
    prNumber: parsed.prNumber,
    description: parsed.description || null,
    label: parsed.prNumber === null ? shortSha(sha) : `PR #${parsed.prNumber}`,
  };
}

/**
 * Resolve one SHA to its merge point against the host clone.
 *
 * Returns null — never throws — when the SHA is absent/not a git SHA or the
 * read fails (shallow clone, unfetched commit, missing mount). The caller
 * renders the technical build stamp it already has instead.
 */
export async function resolveMergePoint(
  input: { sha: string | null | undefined; config?: MergePointConfig },
  deps: MergePointDeps = { execFile: defaultExecFile },
): Promise<MergePoint | null> {
  const sha = input.sha;
  if (!sha || !GIT_SHA_RE.test(sha)) return null;

  const hostSourcePath =
    input.config?.hostSourcePath ?? process.env["HOST_SOURCE_PATH"] ?? "/workspace";
  const [, ...gitArgs] = buildSubjectCommand({ hostSourcePath, sha });
  try {
    const { stdout } = await deps.execFile("git", gitArgs);
    return mergePointFromSubject(sha, stdout);
  } catch {
    return null;
  }
}

/**
 * Resolve both ends of the upgrade comparison in one pass.
 *
 * `runningSha` must be the UPSTREAM lineage marker (the upstream commit the
 * running build absorbed), not the local merge-commit id — a merge commit's
 * subject carries no PR reference, so passing it yields a SHA label and the
 * operator learns nothing. See impact/index.ts for how lineage is resolved.
 */
export async function resolveUpgradeMergePoints(
  input: {
    runningSha: string | null | undefined;
    targetSha: string | null | undefined;
    config?: MergePointConfig;
  },
  deps: MergePointDeps = { execFile: defaultExecFile },
): Promise<{ running: MergePoint | null; available: MergePoint | null }> {
  const [running, available] = await Promise.all([
    resolveMergePoint({ sha: input.runningSha, config: input.config }, deps),
    resolveMergePoint({ sha: input.targetSha, config: input.config }, deps),
  ]);
  return { running, available };
}

/**
 * True when both ends resolved to the SAME merged PR. This is the honest
 * "nothing new to install" signal at operator altitude: it stays true across
 * the merge-commit/upstream-SHA divergence that made raw SHA equality useless.
 *
 * Deliberately conservative — an unresolved end, or either end lacking a PR
 * number, is NOT treated as equal. Freshness itself is still owned by
 * compareUpgradeVersions in version.ts; this only labels it.
 */
export function mergePointsMatch(
  running: MergePoint | null,
  available: MergePoint | null,
): boolean {
  if (!running || !available) return false;
  if (running.prNumber === null || available.prNumber === null) return false;
  return running.prNumber === available.prNumber;
}
