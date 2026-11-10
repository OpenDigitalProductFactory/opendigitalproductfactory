import { err } from "@/lib/shared/action-result";
import type {
  ReleaseInstallContext,
  ReleaseTargetResult,
} from "@/lib/self-upgrade/release-target";
import {
  deferAdmittedRunForRedispatch,
  failRun,
  getRun,
} from "@/lib/self-upgrade/run-store";
import { resolveVerifiedReleaseUpgradeCandidate } from "@/lib/self-upgrade/verified-release-target";

type PublishedReleaseTarget = Exclude<ReleaseTargetResult, { kind: "no-published-target" }>;

export type WorkerReleaseTargetResolution =
  | { kind: "resolved"; target: PublishedReleaseTarget }
  | { kind: "unavailable"; target: Extract<ReleaseTargetResult, { kind: "no-published-target" }> }
  | { kind: "handled"; response: Record<string, unknown> };

/**
 * Resolve the release target at worker start while preserving the immutable
 * target that admission already committed to for a durable run.
 */
export async function resolveWorkerReleaseTarget(input: {
  runId?: string;
  context: ReleaseInstallContext;
  currentConfigDigest: string | null;
}): Promise<WorkerReleaseTargetResolution> {
  const target = await resolveVerifiedReleaseUpgradeCandidate({
    context: input.context,
    currentConfigDigest: input.currentConfigDigest,
  });
  if (target.kind === "no-published-target") {
    if (!input.runId) return { kind: "unavailable", target };
    if (target.reason === "registry-unavailable") {
      const deferred = await deferAdmittedRunForRedispatch(
        input.runId,
        "release-target-registry-unavailable",
      );
      return {
        kind: "handled",
        response: {
          reconciling: deferred,
          reason: deferred ? "registry-unavailable" : "target-recovery-not-claimable",
          runId: input.runId,
          releaseStatus: target.reason,
        },
      };
    }
    await failRun(input.runId, `release-target-integrity-failed: ${target.reason}`);
    return {
      kind: "handled",
      response: {
        ...err(`Release target integrity failed: ${target.reason}`),
        status: "failed",
        reason: "release-target-integrity-failed",
        runId: input.runId,
        releaseStatus: target.reason,
      },
    };
  }

  if (input.runId) {
    const admitted = await getRun(input.runId);
    if (
      !admitted?.targetSha ||
      !admitted.targetTag ||
      admitted.targetSha.toLowerCase() !== target.sourceSha.toLowerCase() ||
      admitted.targetTag !== target.tag
    ) {
      await failRun(
        input.runId,
        "admission-target-drift: worker target differs from durable admission",
      );
      return {
        kind: "handled",
        response: {
          ...err("Worker target differs from the durable admission"),
          status: "failed",
          reason: "admission-target-drift",
          runId: input.runId,
        },
      };
    }
  }

  return { kind: "resolved", target };
}
