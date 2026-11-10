// apps/web/lib/build/review-source-refresh.ts
//
// BI-4F89896B: the guard gauntlet grades a build with the guard scripts of its
// BASE commit, so the build cannot grade itself. A review build whose base
// predates a guard-script fix keeps that defect: on 2026-11-05 all 18 review
// builds on DEV failed every finalize with "the guard gauntlet exited 88"
// because their base carried the stale-root-clone defect fixed in #6909. The
// only rebase was at ship (ship-source-refresh.ts), which a build that never
// passes the gauntlet does not reach.
//
// WWMD DI-A9D0CC59F049's remedy applies here too: keep the guard, refresh,
// re-verify. When the gauntlet could not run, the build is rebased onto
// upstream main in its own clone and review is queued again, so the next
// gauntlet runs current guard scripts on the tree that will be published. A
// conflict is never resolved here; it is recorded and review keeps its sweep.

import type { BuildBranchRefreshOutcome } from "./sandbox/build-branch";

export const REVIEW_SOURCE_REFRESH_TOOL = "review_source_refresh";
/** One refresh per hour at most: a not-run that survives it is not base drift. */
export const REVIEW_SOURCE_REFRESH_RETRY_MS = 60 * 60 * 1000;

export type ReviewSourceRefreshResult =
  | "not-review"
  | "recently-attempted"
  | "refreshed"
  | "conflict"
  | "not-refreshed";

export type ReviewSourceRefreshDeps = {
  loadPhase(buildId: string): Promise<string | null>;
  lastAttemptAt(buildId: string): Promise<Date | null>;
  refresh(buildId: string): Promise<BuildBranchRefreshOutcome>;
  queueReview(buildId: string): Promise<void>;
  record(buildId: string, summary: string): Promise<void>;
  now(): Date;
};

export async function refreshReviewBuildAfterGauntletNotRun(
  buildId: string,
  reason: string,
  deps: ReviewSourceRefreshDeps = defaultDeps(),
): Promise<ReviewSourceRefreshResult> {
  if ((await deps.loadPhase(buildId)) !== "review") return "not-review";
  const last = await deps.lastAttemptAt(buildId);
  if (last && deps.now().getTime() - last.getTime() < REVIEW_SOURCE_REFRESH_RETRY_MS) return "recently-attempted";

  const outcome = await deps.refresh(buildId).catch((err: unknown): BuildBranchRefreshOutcome => ({
    status: "unknown",
    reason: err instanceof Error ? err.message.slice(0, 300) : String(err),
  }));
  const because = `The guard gauntlet could not run (${reason.slice(0, 200)})`;

  if (outcome.status === "conflict") {
    await deps.record(
      buildId,
      `${because}; refreshing onto upstream main conflicts in ${outcome.files.join(", ") || "unnamed files"}. ` +
        "The rebase was aborted and the build stays in review.",
    );
    return "conflict";
  }
  if (outcome.status !== "refreshed") {
    await deps.record(buildId, `${because}; could not refresh onto upstream main: ${outcome.reason}`);
    return "not-refreshed";
  }
  await deps.record(
    buildId,
    `${because}; refreshed onto upstream main (now ${outcome.headSha.slice(0, 9)}) so the next gauntlet grades with current guard scripts.`,
  );
  await deps.queueReview(buildId);
  return "refreshed";
}

function defaultDeps(): ReviewSourceRefreshDeps {
  return {
    async loadPhase(buildId) {
      const { prisma } = await import("@dpf/db");
      const row = await prisma.featureBuild.findUnique({ where: { buildId }, select: { phase: true } });
      return row?.phase ?? null;
    },
    async lastAttemptAt(buildId) {
      const { prisma } = await import("@dpf/db");
      const row = await prisma.buildActivity.findFirst({
        where: { buildId, tool: REVIEW_SOURCE_REFRESH_TOOL },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return row?.createdAt ?? null;
    },
    async refresh(buildId) {
      const { refreshBuildBranchOntoUpstream } = await import("./sandbox/build-branch");
      return refreshBuildBranchOntoUpstream(buildId);
    },
    async queueReview(buildId) {
      const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
      await queueBuildReviewVerification(buildId);
    },
    async record(buildId, summary) {
      const { prisma } = await import("@dpf/db");
      await prisma.buildActivity.create({ data: { buildId, tool: REVIEW_SOURCE_REFRESH_TOOL, summary } }).catch(() => {});
    },
    now: () => new Date(),
  };
}
