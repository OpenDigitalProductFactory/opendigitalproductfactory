// apps/web/lib/self-upgrade/release-batch-status.ts
//
// IO wiring for the release-batch tally (release-batch.ts holds the pure
// logic). One resolver, consumed by every surface that must agree on "is a
// routine upgrade imminent, or are more merged PRs still to be tallied?":
// the request layer (request_self_upgrade), the read-only MCP queue-status
// tool, and the Upgrade Center status panel. The scheduled runner wires the
// same primitives itself (it has already fetched and resolved its paths).

import { getSelfUpgradeConfig, type SelfUpgradeConfig } from "./config";
import { getLatestSucceededRun } from "./run-store";
import { defaultGitRunner } from "./prepare-source";
import type { GitRunner } from "./prepare-source";
import { buildFetchCommand } from "./version";
import {
  readSelfUpgradeSupport,
  type SelfUpgradeSupport,
} from "./support";
import {
  countPendingUpstreamCommits,
  evaluateReleaseBatch,
  describeReleaseBatch,
  type ReleaseBatchDecision,
} from "./release-batch";

export type ReleaseBatchStatus = Omit<ReleaseBatchDecision, "reason"> & {
  reason:
    | ReleaseBatchDecision["reason"]
    | "release-artifact"
    | "install-identity-unverified";
  support: SelfUpgradeSupport;
  /** False when the install does not track an upstream (local sourceMode) — batching does not apply. */
  applicable: boolean;
  /** The upstream lineage marker the tally counts from, or null before the first succeeded run. */
  lineageSha: string | null;
  /** One plain-English line for operators/agents. */
  summary: string;
};

/**
 * Resolve the current release-batch state. `fresh: true` fetches the upstream
 * ref first (network round-trip) — use it on agent requests where the caller
 * likely just merged a PR; leave it false for display surfaces, which can ride
 * the hourly scheduled fetch. Never throws: any git/DB failure degrades to an
 * uncomputable tally, which evaluates fail-open.
 */
export async function resolveReleaseBatchStatus(
  opts: {
    fresh?: boolean;
    now?: Date;
    config?: SelfUpgradeConfig;
    support?: SelfUpgradeSupport;
    gitRun?: GitRunner;
  } = {},
): Promise<ReleaseBatchStatus> {
  const now = opts.now ?? new Date();
  const config = opts.config ?? (await getSelfUpgradeConfig());
  const gitRun = opts.gitRun ?? defaultGitRunner;
  const support = opts.support ?? (await readSelfUpgradeSupport(config.enabled));

  if (!support.supported) {
    return {
      applicable: false,
      eligible: false,
      reason: support.reason,
      pendingCount: null,
      minPendingPrs: config.batchMinPendingPrs,
      maxWaitHours: config.batchMaxWaitHours,
      oldestPendingAt: null,
      lineageSha: null,
      summary: support.message,
      support,
    };
  }

  if (support.targetKind === "release-artifact") {
    return {
      applicable: false,
      eligible: true,
      reason: "release-artifact",
      pendingCount: null,
      minPendingPrs: config.batchMinPendingPrs,
      maxWaitHours: config.batchMaxWaitHours,
      oldestPendingAt: null,
      lineageSha: null,
      summary: "Published releases are already verified as a complete batch; Git commit batching does not apply.",
      support,
    };
  }

  const hostSourcePath =
    config.hostSourceMountPath ??
    process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT ??
    process.env.HOST_SOURCE_PATH ??
    "/host-dpf";
  const remote = config.repositoryRemote ?? process.env.REPO_REMOTE ?? "origin";
  const branch = config.repositoryBranch ?? process.env.REPO_BRANCH ?? "main";

  const applicable = config.sourceMode === "upstream";
  const lineageSha = applicable
    ? ((await getLatestSucceededRun().catch(() => null))?.targetSha ?? null)
    : null;

  let tally: { pendingCount: number | null; oldestPendingAt: Date | null } = {
    pendingCount: null,
    oldestPendingAt: null,
  };
  if (applicable && lineageSha) {
    if (opts.fresh) {
      // Best-effort freshen so a just-merged PR is visible to the tally.
      try {
        await gitRun(buildFetchCommand({ hostSourcePath, remote, branch }).slice(1));
      } catch {
        // Stale refs degrade the tally, never the request.
      }
    }
    tally = await countPendingUpstreamCommits(
      { hostSourcePath, remote, branch, sinceSha: lineageSha },
      gitRun,
    );
  }

  const decision = evaluateReleaseBatch({
    tally,
    minPendingPrs: config.batchMinPendingPrs,
    maxWaitHours: config.batchMaxWaitHours,
    now,
  });

  return {
    ...decision,
    support,
    applicable,
    lineageSha,
    summary: applicable
      ? describeReleaseBatch(decision)
      : "This install builds from its own local tree; release batching does not apply.",
  };
}
