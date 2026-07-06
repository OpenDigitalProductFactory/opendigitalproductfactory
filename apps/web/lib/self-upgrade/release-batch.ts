// apps/web/lib/self-upgrade/release-batch.ts
//
// Release batching for ROUTINE self-upgrades. Every governed upgrade drains the
// portal (quiescence refuses new MCP/portal actions), rebuilds, and swaps — so
// with an active merge queue upstream, upgrading on ANY new commit means one
// full drain per merged PR. Batching accumulates merged PRs and lets the
// routine paths (the scheduled cron and agent-requested upgrades) trigger only
// once a batch is worth the disruption:
//
//   eligible ⇔ pendingCount >= minPendingPrs
//            OR the oldest pending merged commit has waited past maxWaitHours
//            (bounded staleness for low-traffic installs)
//            OR the tally is uncomputable (fail OPEN — batching is a
//            disruption optimization, never an upgrade-liveness gate)
//
// Operator manual "Upgrade now" and force triggers are NOT batch-gated — the
// operator has chosen the moment. Kernel decision: count-threshold-plus-max-wait
// (principle_decide margin 0.628, high confidence).
//
// The tally is `git rev-list --count <lineage>..<remote>/<branch>` where the
// lineage marker is the upstream SHA the running build absorbed (the latest
// succeeded run's targetSha — same marker the §5.0 up-to-date gate uses). With
// the merge queue squash-merging every PR, commits on the upstream branch ≈
// merged PRs. Install clones are routinely SHALLOW, so the lineage commit may
// be outside the local history: the counter attempts one bounded `--deepen`
// and otherwise reports null (⇒ fail open).

import type { GitRunner } from "./prepare-source";

/** Default batch size: routine upgrades wait for at least this many merged PRs. */
export const DEFAULT_BATCH_MIN_PENDING_PRS = 10;

/**
 * Default bounded-staleness valve (hours). When the OLDEST pending merged
 * commit has waited this long, the batch becomes eligible even below the count
 * threshold, so a low-traffic install still converges without operator action.
 * 0 disables the valve.
 */
export const DEFAULT_BATCH_MAX_WAIT_HOURS = 168;

/**
 * How far one corrective `git fetch --deepen` reaches when the lineage commit
 * is behind a shallow-clone boundary. Sized at several batches' worth of
 * history; if the lineage is further back than this, the tally fails open.
 */
export const BATCH_DEEPEN_COMMITS = 200;

export type ReleaseBatchTally = {
  /** Merged upstream commits (≈ PRs) not yet absorbed, or null when uncomputable. */
  pendingCount: number | null;
  /** Committer time of the oldest pending commit, or null when uncomputable/none. */
  oldestPendingAt: Date | null;
};

export type ReleaseBatchDecision = {
  /** True when a routine upgrade may proceed. */
  eligible: boolean;
  reason:
    | "batching-disabled" // minPendingPrs <= 1 — every new commit is a batch
    | "threshold-met" // pendingCount >= minPendingPrs
    | "max-wait-elapsed" // oldest pending commit outwaited maxWaitHours
    | "tally-uncomputable" // fail open: shallow history / no lineage / git error
    | "below-threshold"; // accumulate further; routine upgrade waits
  pendingCount: number | null;
  minPendingPrs: number;
  maxWaitHours: number;
  oldestPendingAt: Date | null;
};

/**
 * Pure batch-eligibility evaluator. `pendingCount === null` means the tally
 * could not be computed — batching fails OPEN so it can never strand an
 * install on old code.
 */
export function evaluateReleaseBatch(args: {
  tally: ReleaseBatchTally;
  minPendingPrs: number;
  maxWaitHours: number;
  now: Date;
}): ReleaseBatchDecision {
  const { tally, minPendingPrs, maxWaitHours, now } = args;
  const base = {
    pendingCount: tally.pendingCount,
    minPendingPrs,
    maxWaitHours,
    oldestPendingAt: tally.oldestPendingAt,
  };
  if (!(minPendingPrs > 1)) {
    return { eligible: true, reason: "batching-disabled", ...base };
  }
  if (tally.pendingCount === null) {
    return { eligible: true, reason: "tally-uncomputable", ...base };
  }
  if (tally.pendingCount >= minPendingPrs) {
    return { eligible: true, reason: "threshold-met", ...base };
  }
  if (
    maxWaitHours > 0 &&
    tally.oldestPendingAt !== null &&
    now.getTime() - tally.oldestPendingAt.getTime() >= maxWaitHours * 60 * 60 * 1000
  ) {
    return { eligible: true, reason: "max-wait-elapsed", ...base };
  }
  return { eligible: false, reason: "below-threshold", ...base };
}

/**
 * `git -C <path> log --reverse --format=%ct <since>..<remote>/<branch>` — one
 * committer-epoch line per pending commit, oldest first. Line count = pending
 * tally; first line = oldest pending commit time.
 */
export function buildPendingLogCommand(input: {
  hostSourcePath: string;
  remote: string;
  branch: string;
  sinceSha: string;
}): string[] {
  return [
    "git",
    "-C",
    input.hostSourcePath,
    "log",
    "--reverse",
    "--format=%ct",
    `${input.sinceSha}..${input.remote}/${input.branch}`,
  ];
}

/**
 * `git -C <path> fetch --deepen=<n> <remote> <branch>` — one bounded history
 * deepen so a shallow install clone can usually resolve the lineage commit.
 */
export function buildDeepenCommand(input: {
  hostSourcePath: string;
  remote: string;
  branch: string;
  deepenCommits?: number;
}): string[] {
  return [
    "git",
    "-C",
    input.hostSourcePath,
    "fetch",
    `--deepen=${input.deepenCommits ?? BATCH_DEEPEN_COMMITS}`,
    input.remote,
    input.branch,
  ];
}

/** Parse `log --format=%ct` output into a tally. Exposed for tests. */
export function parsePendingLog(stdout: string): ReleaseBatchTally {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l));
  if (lines.length === 0) return { pendingCount: 0, oldestPendingAt: null };
  return {
    pendingCount: lines.length,
    oldestPendingAt: new Date(Number(lines[0]) * 1000),
  };
}

/**
 * Count merged upstream commits (≈ PRs) after `sinceSha`. Never throws:
 * returns `{ pendingCount: null }` when the range is uncomputable (missing
 * lineage object in a shallow clone even after one bounded deepen, git error),
 * which the evaluator treats as fail-open. Callers are responsible for having
 * fetched the remote ref first when freshness matters.
 */
export async function countPendingUpstreamCommits(
  input: { hostSourcePath: string; remote: string; branch: string; sinceSha: string },
  gitRun: GitRunner,
): Promise<ReleaseBatchTally> {
  const logArgs = buildPendingLogCommand(input).slice(1);
  try {
    let result = await gitRun(logArgs);
    if (result.code !== 0) {
      // Most common cause: the lineage commit is behind a shallow boundary.
      // One bounded deepen, then retry once.
      const deepen = await gitRun(buildDeepenCommand(input).slice(1));
      if (deepen.code !== 0) return { pendingCount: null, oldestPendingAt: null };
      result = await gitRun(logArgs);
      if (result.code !== 0) return { pendingCount: null, oldestPendingAt: null };
    }
    return parsePendingLog(result.stdout);
  } catch {
    return { pendingCount: null, oldestPendingAt: null };
  }
}

/** One-line operator/agent-facing summary of a batch decision. */
export function describeReleaseBatch(decision: ReleaseBatchDecision): string {
  const count = decision.pendingCount === null ? "?" : String(decision.pendingCount);
  if (!decision.eligible) {
    return `${count} of ${decision.minPendingPrs} merged updates accumulated — routine upgrades deploy in batches; more updates are still to be tallied.`;
  }
  switch (decision.reason) {
    case "threshold-met":
      return `${count} merged updates accumulated (threshold ${decision.minPendingPrs}) — the batch is ready to deploy.`;
    case "max-wait-elapsed":
      return `${count} merged update(s) waited past ${decision.maxWaitHours}h — deploying without a full batch.`;
    case "batching-disabled":
      return "Release batching is disabled — any new update deploys on the next routine run.";
    default:
      return "Pending-update tally unavailable — routine upgrades proceed without batching.";
  }
}
