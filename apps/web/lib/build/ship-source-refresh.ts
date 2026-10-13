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
};

function storedSourceCurrency(state: unknown): SandboxSourceCurrencySnapshot | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const snapshot = (state as Record<string, unknown>).sourceCurrency;
  return snapshot && typeof snapshot === "object" ? (snapshot as SandboxSourceCurrencySnapshot) : null;
}

/**
 * Whether a stored snapshot is the publication refusal this refresh exists for:
 * local source work AND missing upstream commits, on a clean tree. A dirty or
 * unknown snapshot is a different problem and is left to its own recovery.
 */
export function isRefreshableDivergence(snapshot: SandboxSourceCurrencySnapshot | null): boolean {
  return snapshot?.status === "diverged" && snapshot.recommendedAction === "pause" && snapshot.dirty !== true;
}

export async function refreshDivergedShipBuild(
  buildId: string,
  deps: ShipSourceRefreshDeps = defaultDeps(),
): Promise<ShipSourceRefreshResult> {
  const build = await deps.loadBuild(buildId);
  if (!build || build.phase !== "ship") return "not-ship";
  const snapshot = storedSourceCurrency(build.buildExecState);
  if (!isRefreshableDivergence(snapshot)) return "not-diverged";

  const last = await deps.lastAttemptAt(buildId);
  if (last && deps.now().getTime() - last.getTime() < SHIP_SOURCE_REFRESH_RETRY_MS) return "recently-attempted";

  const before = `${snapshot?.aheadBy ?? "?"} ahead / ${snapshot?.behindBy ?? "?"} behind ${snapshot?.targetRef ?? "its base"}`;
  const outcome = await deps.refresh(buildId).catch((err: unknown): BuildBranchRefreshOutcome => ({
    status: "unknown",
    reason: err instanceof Error ? err.message.slice(0, 300) : String(err),
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
    async returnToReview(buildId, buildExecState) {
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
    },
    async queueReview(buildId) {
      const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
      await queueBuildReviewVerification(buildId);
    },
    async record(buildId, summary) {
      const { prisma } = await import("@dpf/db");
      await prisma.buildActivity.create({ data: { buildId, tool: SHIP_SOURCE_REFRESH_TOOL, summary } }).catch(() => {});
    },
    now: () => new Date(),
  };
}
