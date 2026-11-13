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
// conflict is never resolved here. BI-2CCD5C0E: leaving a conflicted build in
// review re-crashed its gauntlet every sweep forever, so the conflict goes back
// to the build's coding agent through the shared bounded hand-back
// (gauntlet-repair.ts, BI-FBA2FDBE), and to the owner once the bound is spent.

import type { GauntletFailure, RouteOutcome } from "./gauntlet-repair";
import type { BuildBranchRefreshOutcome } from "./sandbox/build-branch";

export const REVIEW_SOURCE_REFRESH_TOOL = "review_source_refresh";
/** One refresh per hour at most: a not-run that survives it is not base drift. */
export const REVIEW_SOURCE_REFRESH_RETRY_MS = 60 * 60 * 1000;
/**
 * BI-E3C5C7E4: refreshes per day before the loop stops. Hourly refresh with no
 * total bound re-ran the gauntlet ~24 times a day per build for a week when the
 * crash was not base drift (exit 88 on 33 builds, 11,090 finalize passes).
 */
export const REVIEW_SOURCE_REFRESH_MAX_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewSourceRefreshResult =
  | "not-review"
  | "recently-attempted"
  | "refresh-exhausted"
  | "refreshed"
  | "conflict-repair-queued"
  | "conflict-escalated"
  | "conflict"
  | "not-refreshed";

export type ReviewSourceRefreshDeps = {
  loadPhase(buildId: string): Promise<string | null>;
  lastAttemptAt(buildId: string): Promise<Date | null>;
  attemptsSince(buildId: string, since: Date): Promise<number>;
  refresh(buildId: string): Promise<BuildBranchRefreshOutcome>;
  queueReview(buildId: string): Promise<void>;
  record(buildId: string, summary: string): Promise<void>;
  routeConflictToRepair(buildId: string, failure: GauntletFailure): Promise<RouteOutcome>;
  now(): Date;
};

export function conflictRepairFailure(files: string[], ontoRef?: string): GauntletFailure {
  const named = files.length > 0 ? files : ["(git did not name the conflicted files)"];
  return {
    treeSha: null,
    recordId: null,
    failedGuards: ["Refresh onto upstream main"],
    source: "conflict",
    findings: named.map((file) => ({ severity: "important", description: `Conflicts with upstream main in ${file}` })),
    ...(ontoRef ? { ontoRef } : {}),
  };
}

export async function refreshReviewBuildAfterGauntletNotRun(
  buildId: string,
  reason: string,
  deps: ReviewSourceRefreshDeps = defaultDeps(),
): Promise<ReviewSourceRefreshResult> {
  if ((await deps.loadPhase(buildId)) !== "review") return "not-review";
  const last = await deps.lastAttemptAt(buildId);
  if (last && deps.now().getTime() - last.getTime() < REVIEW_SOURCE_REFRESH_RETRY_MS) return "recently-attempted";
  const recent = await deps.attemptsSince(buildId, new Date(deps.now().getTime() - DAY_MS));
  if (recent >= REVIEW_SOURCE_REFRESH_MAX_PER_DAY) {
    await deps.record(
      buildId,
      `The guard gauntlet still could not run after ${recent} refreshes onto upstream main in 24 hours ` +
        `(${reason.slice(0, 200)}). That is not base drift, so review is not re-queued; the build waits for the gauntlet crash to be fixed.`,
    );
    return "refresh-exhausted";
  }

  const outcome = await deps.refresh(buildId).catch((err: unknown): BuildBranchRefreshOutcome => ({
    status: "unknown",
    reason: err instanceof Error ? err.message.slice(0, 300) : String(err),
  }));
  const because = `The guard gauntlet could not run (${reason.slice(0, 200)})`;

  if (outcome.status === "conflict") {
    const routed = await deps
      .routeConflictToRepair(buildId, conflictRepairFailure(outcome.files, outcome.ontoRef))
      .catch((): RouteOutcome | "route-failed" => "route-failed");
    const next = routed === "repair-queued"
      ? "it is handed back to the coding agent to rebase and resolve them."
      : routed === "escalated" || routed === "already-escalated"
        ? "the repair attempts are spent, so the owner has been asked to resolve or retire it."
        : `it could not be handed back (${routed}).`;
    await deps.record(
      buildId,
      `${because}; refreshing onto upstream main conflicts in ${outcome.files.join(", ") || "unnamed files"}. ` +
        `The rebase was aborted and ${next}`,
    );
    if (routed === "repair-queued") return "conflict-repair-queued";
    if (routed === "escalated" || routed === "already-escalated") return "conflict-escalated";
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
    async attemptsSince(buildId, since) {
      const { prisma } = await import("@dpf/db");
      return prisma.buildActivity.count({
        where: { buildId, tool: REVIEW_SOURCE_REFRESH_TOOL, createdAt: { gte: since } },
      });
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
    async routeConflictToRepair(buildId, failure) {
      const { routeGauntletFailureToRepair } = await import("./gauntlet-repair");
      return routeGauntletFailureToRepair(buildId, failure);
    },
    now: () => new Date(),
  };
}
