// apps/web/lib/build/ship-source-refresh.ts
//
// BI-76BD65E6: a build that reaches ship and then waits while main moves on is
// classed "diverged" by the source-currency check, and create_portal_pr refuses
// to publish it. The refusal is right — publication lays the clone's touched
// files over current main, so an un-rebased branch would revert upstream edits —
// but nothing acted on it: the ship reconciler retried the same refused PR every
// hour, forever (FB-2E891686 and FB-2F2D46D5 from 2026-10-08).
//
// WWMD DI-A9D0CC59F049 settled the remedy: keep the guard, refresh, re-verify.
// The build is rebased onto upstream main in its own clone, and on a clean
// rebase it goes back to review with its tree-bound evidence cleared, so the
// review pipeline re-earns capture, platform verification, semantic review and
// the gauntlet on the tree that will actually be published. A conflict is never
// resolved here: the build stays in ship and the conflicted files are recorded.

import { errorTail } from "./error-tail";
import type { BuildBranchRefreshOutcome } from "./sandbox/build-branch";
import type { SandboxSourceCurrencySnapshot } from "./sandbox/sandbox-source-currency";

export const SHIP_SOURCE_REFRESH_TOOL = "ship_source_refresh";
/** A conflict or failed refresh waits this long before the next attempt. */
export const SHIP_SOURCE_REFRESH_RETRY_MS = 6 * 60 * 60 * 1000;

export type ShipSourceRefreshResult =
  | "not-ship"
  | "not-diverged"
  | "recently-attempted"
  | "returned-to-review"
  | "conflict"
  | "not-refreshed";

type ShipBuildRow = {
  phase: string;
  buildExecState: unknown;
};

export type ShipSourceRefreshDeps = {
  loadBuild(buildId: string): Promise<ShipBuildRow | null>;
  lastAttemptAt(buildId: string): Promise<Date | null>;
  refresh(buildId: string): Promise<BuildBranchRefreshOutcome>;
  /** Guarded ship→review flip; false when the row was no longer in ship. */
  returnToReview(buildId: string, buildExecState: Record<string, unknown>): Promise<boolean>;
  queueReview(buildId: string): Promise<void>;
  record(buildId: string, summary: string): Promise<void>;
  now(): Date;
  /**
   * BI-C49EC080: true once the build's pull request is published. Its commit is
   * then what ships and what is reviewed, and the merge queue owns currency
   * with main; rebasing the clone would move it off the PR commit it was put on.
   */
  hasPublishedPr?(buildId: string): Promise<boolean>;
};

function storedSourceCurrency(state: unknown): SandboxSourceCurrencySnapshot | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const snapshot = (state as Record<string, unknown>).sourceCurrency;
  return snapshot && typeof snapshot === "object" ? (snapshot as SandboxSourceCurrencySnapshot) : null;
}

/**
 * Whether a stored snapshot is a publication refusal this refresh can clear: a
 * clean tree that is missing upstream commits, with local work (diverged) or
 * without (behind). Both are cleared by the same rebase. A dirty or unknown
 * snapshot is a different problem and is left to its own recovery.
 */
export function isRefreshableDivergence(snapshot: SandboxSourceCurrencySnapshot | null): boolean {
  if (!snapshot || snapshot.dirty === true) return false;
  return (snapshot.status === "diverged" && snapshot.recommendedAction === "pause")
    || (snapshot.status === "behind" && snapshot.recommendedAction === "auto-refresh");
}

export async function refreshDivergedShipBuild(
  buildId: string,
  deps: ShipSourceRefreshDeps = defaultDeps(),
  /**
   * `force`: the PR attempt itself was refused as diverged (BI-34A05E78), which
   * is fresher evidence than a stored snapshot that may predate main moving.
   */
  opts: { force?: boolean } = {},
): Promise<ShipSourceRefreshResult> {
  const build = await deps.loadBuild(buildId);
  if (!build || build.phase !== "ship") return "not-ship";
  const snapshot = storedSourceCurrency(build.buildExecState);
  if (!opts.force && !isRefreshableDivergence(snapshot)) return "not-diverged";
  if (!opts.force && (await deps.hasPublishedPr?.(buildId))) return "not-diverged";

  const last = await deps.lastAttemptAt(buildId);
  if (last && deps.now().getTime() - last.getTime() < SHIP_SOURCE_REFRESH_RETRY_MS) return "recently-attempted";

  const before = `${snapshot?.aheadBy ?? "?"} ahead / ${snapshot?.behindBy ?? "?"} behind ${snapshot?.targetRef ?? "its base"}`;
  const outcome = await deps.refresh(buildId).catch((err: unknown): BuildBranchRefreshOutcome => ({
    status: "unknown",
    reason: errorTail(err),
  }));

  if (outcome.status === "conflict") {
    await deps.record(
      buildId,
      `Could not refresh onto upstream main (was ${before}): rebasing conflicts in ${outcome.files.join(", ") || "unnamed files"}. ` +
        "The rebase was aborted and the build stays in ship; its PR stays refused until the conflict is resolved.",
    );
    return "conflict";
  }
  if (outcome.status !== "refreshed") {
    await deps.record(buildId, `Could not refresh onto upstream main (was ${before}): ${outcome.reason}`);
    return "not-refreshed";
  }

  // The rebase invalidated every tree-bound record: the stored snapshot, the
  // acceptance and verification judged on the old tree. Drop the snapshot so
  // nothing reads it before review captures the new one.
  const state = build.buildExecState && typeof build.buildExecState === "object" && !Array.isArray(build.buildExecState)
    ? { ...(build.buildExecState as Record<string, unknown>) }
    : {};
  delete state.sourceCurrency;
  if (!(await deps.returnToReview(buildId, state))) return "not-ship";
  await deps.record(
    buildId,
    `Refreshed onto upstream main (was ${before}; now ${outcome.headSha.slice(0, 9)}). ` +
      "Returned to review so the rebased tree is verified, reviewed and accepted again before its PR opens.",
  );
  await deps.queueReview(buildId);
  return "returned-to-review";
}

/**
 * The ship reconciler's step for a build not yet deployed: a diverged build is
 * refreshed first (and leaves ship for review). Anything else gets the PR
 * retry, and a refused retry is classified and remedied (BI-34A05E78): retries
 * back off while nothing can move the build, and an escalated build is not
 * retried again. Returns true when the build is done with this tick (it left
 * ship or was escalated), so the caller skips it.
 */
export type ShipPrStepDeps = {
  /** BI-C49EC080: a published PR head with no review of its own goes back to review first. */
  reviewPublishedHead?: (buildId: string) => Promise<import("./published-head-review").PublishedHeadReviewResult>;
  refresh?: (buildId: string) => Promise<ShipSourceRefreshResult>;
  retry?: (buildId: string, logger: Pick<Console, "error">, retryIntervalMs: number) => Promise<"opened" | "blocked" | "skipped">;
  remedy?: Pick<typeof import("./ship-refusal-remedy"), "loadShipRefusalHistory" | "remedyRefusedShipBuild" | "shipPrRetryIntervalMs">;
};

export async function refreshOrRetryShipBuildPr(
  buildId: string,
  logger: Pick<Console, "log" | "error">,
  deps: ShipPrStepDeps = {},
): Promise<boolean> {
  const reviewPublishedHead = deps.reviewPublishedHead
    ?? (await import("./published-head-review")).reviewPublishedHeadForShipBuild;
  if ((await reviewPublishedHead(buildId)) === "returned-to-review") {
    logger.log(`[auto-complete] ${buildId} put on its published PR commit and returned to review`);
    return true;
  }
  if ((await (deps.refresh ?? refreshDivergedShipBuild)(buildId)) === "returned-to-review") {
    logger.log(`[auto-complete] ${buildId} refreshed onto upstream main and returned to review`);
    return true;
  }
  const remedy = deps.remedy ?? (await import("./ship-refusal-remedy"));
  const retry = deps.retry ?? (await import("./auto-open-build-pr")).retryPrForShipBuild;
  const history = await remedy.loadShipRefusalHistory(buildId);
  if (history.some((h) => h.action === "escalate")) return true;
  if ((await retry(buildId, logger, remedy.shipPrRetryIntervalMs(history))) !== "blocked") return false;
  const outcome = await remedy.remedyRefusedShipBuild(buildId);
  const moved = outcome !== "wait" && outcome !== "none";
  if (moved) logger.log(`[auto-complete] ${buildId} PR refused; remedy: ${outcome}`);
  return moved;
}

function defaultDeps(): ShipSourceRefreshDeps {
  return {
    async loadBuild(buildId) {
      const { prisma } = await import("@dpf/db");
      return prisma.featureBuild.findUnique({ where: { buildId }, select: { phase: true, buildExecState: true } });
    },
    async lastAttemptAt(buildId) {
      const { prisma } = await import("@dpf/db");
      const row = await prisma.buildActivity.findFirst({
        where: { buildId, tool: SHIP_SOURCE_REFRESH_TOOL },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return row?.createdAt ?? null;
    },
    async refresh(buildId) {
      const { refreshBuildBranchOntoUpstream } = await import("./sandbox/build-branch");
      return refreshBuildBranchOntoUpstream(buildId);
    },
    returnToReview: returnShipBuildToReview,
    async queueReview(buildId) {
      const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
      await queueBuildReviewVerification(buildId);
    },
    async record(buildId, summary) {
      const { prisma } = await import("@dpf/db");
      await prisma.buildActivity.create({ data: { buildId, tool: SHIP_SOURCE_REFRESH_TOOL, summary } }).catch(() => {});
    },
    now: () => new Date(),
    async hasPublishedPr(buildId) {
      const { prisma } = await import("@dpf/db");
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { id: true } });
      if (!build) return false;
      const room = await prisma.workroom.findFirst({
        where: { featureBuildId: build.id, archivedAt: null, pullRequestUrl: { not: null } },
        select: { id: true },
      });
      return Boolean(room);
    },
  };
}

/**
 * Guarded ship→review flip that drops every record judged on the old tree
 * (acceptance, verification, UX status). False when the build had left ship.
 */
export async function returnShipBuildToReview(buildId: string, buildExecState: Record<string, unknown>): Promise<boolean> {
  const { prisma, Prisma } = await import("@dpf/db");
  const flipped = await prisma.featureBuild.updateMany({
    where: { buildId, phase: "ship" },
    data: {
      phase: "review",
      acceptanceMet: Prisma.DbNull,
      verificationOut: Prisma.DbNull,
      uxVerificationStatus: null,
      buildExecState: buildExecState as import("@dpf/db").Prisma.InputJsonValue,
    },
  });
  return flipped.count > 0;
}
