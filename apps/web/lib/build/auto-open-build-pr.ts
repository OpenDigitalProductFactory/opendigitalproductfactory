// apps/web/lib/build/auto-open-build-pr.ts
//
// BI-D80F2EA0 — founder decision (2026-09-25): once review passes and the build
// reaches ship, Build Studio opens its PR itself instead of waiting for a human
// click. create_portal_pr keeps every publication guard (verification readiness,
// the preflight record for the exact tree); a refusal is recorded on the build.
// A PR is not a merge: required checks, the merge queue and human review still
// decide what lands.

import { PR_FOLLOW_UP_PREFIX, PR_FOLLOW_UP_UNCHANGED, PR_FOLLOW_UP_UNCHANGED_PREFIX } from "./pr-ci-repair-markers";

export type AutoPrDeps = {
  phaseOf: (buildId: string) => Promise<string | null>;
  existingPrUrl: (buildId: string) => Promise<string | null>;
  /**
   * BI-F31DB5F8: true when the build's open pull request is missing files of
   * the build's change and has not been republished yet. Such a build is
   * published again in full, once, instead of being left with a PR that can
   * never pass.
   */
  publishedIncomplete?: (buildId: string) => Promise<boolean>;
  /** BI-085A37EC: a CI repair of the open PR still owes it a follow-up commit. */
  followUpPending?: (buildId: string) => Promise<boolean>;
  /** BI-085A37EC: the repair changed nothing, so a person is told once. */
  followUpUnchanged?: (buildId: string, detail: string) => Promise<void>;
  createPr: (buildId: string, actorUserId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  log: (summary: string) => Promise<void>;
};

export async function openBuildStudioPrAfterShip(input: {
  buildId: string;
  actorUserId: string;
  deps?: AutoPrDeps;
}): Promise<"opened" | "blocked" | "skipped"> {
  const deps = input.deps ?? (await productionDeps(input.buildId));
  if ((await deps.phaseOf(input.buildId)) !== "ship") return "skipped";
  const republish = Boolean(await deps.existingPrUrl(input.buildId));
  const followUp = republish && Boolean(await deps.followUpPending?.(input.buildId));
  if (republish && !followUp && !(await deps.publishedIncomplete?.(input.buildId))) return "skipped";
  const result = await deps.createPr(input.buildId, input.actorUserId);
  const detail = String(result.message ?? result.error ?? "").slice(0, 400);
  if (result.success) {
    await deps.log(followUp
      ? `${PR_FOLLOW_UP_PREFIX} ${detail}`
      : republish
        ? `${REPUBLISHED_PREFIX} its pull request was missing files of the change: ${detail}`
        : `Opened the pull request automatically after review: ${detail}`);
    return "opened";
  }
  if (followUp && detail.includes(PR_FOLLOW_UP_UNCHANGED)) {
    await deps.log(`${PR_FOLLOW_UP_UNCHANGED_PREFIX} ${detail}`);
    await deps.followUpUnchanged?.(input.buildId, detail);
    return "blocked";
  }
  await deps.log(`Pull request not opened; a publication guard refused: ${detail}`);
  return "blocked";
}

/** Trail marker of the one full republish a build gets (BI-F31DB5F8). */
export const REPUBLISHED_PREFIX = "Republished the whole change;";

/** Paths of the build's change that the published commit does not carry. */
export function missingPublishedPaths(changePaths: readonly string[], publishedPaths: readonly string[]): string[] {
  const published = new Set(publishedPaths);
  return changePaths.filter((path) => !published.has(path));
}

/** How long a refused PR attempt stands before the ship reconciler tries again. */
export const SHIP_PR_RETRY_MS = 60 * 60 * 1000;

/**
 * The PR is opened once, at review->ship. A refusal there (a guard, a stale
 * sandbox, a since-fixed defect) left the build in ship with no PR and nothing
 * to try again: FB-2E891686, the first build to reach ship unattended
 * (2026-10-08), was refused "No active build" and never retried. The ship
 * reconciler calls this for each ship build: it retries at most once per
 * SHIP_PR_RETRY_MS, and openBuildStudioPrAfterShip skips a build with its PR.
 */
export async function retryBuildStudioPrForShipBuild(input: {
  buildId: string;
  actorUserId: string;
  lastAttemptAt: Date | null;
  now?: Date;
  deps?: AutoPrDeps;
  /** BI-34A05E78: the ship refusal remedy backs this off while nothing changes. */
  retryIntervalMs?: number;
}): Promise<"opened" | "blocked" | "skipped"> {
  const now = input.now ?? new Date();
  const interval = input.retryIntervalMs ?? SHIP_PR_RETRY_MS;
  if (input.lastAttemptAt && now.getTime() - input.lastAttemptAt.getTime() < interval) return "skipped";
  return openBuildStudioPrAfterShip({ buildId: input.buildId, actorUserId: input.actorUserId, deps: input.deps });
}

/**
 * The ship reconciler's hook: reads the build's owner and its last PR attempt,
 * then retries. Never throws; a failure is logged and the next tick tries again.
 */
export async function retryPrForShipBuild(
  buildId: string,
  logger: Pick<Console, "error">,
  retryIntervalMs?: number,
): Promise<"opened" | "blocked" | "skipped"> {
  try {
    const { prisma } = await import("@dpf/db");
    const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { createdById: true } });
    if (!build?.createdById) return "skipped";
    const lastAttempt = await prisma.buildActivity.findFirst({
      where: { buildId, tool: "auto_open_pr" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return await retryBuildStudioPrForShipBuild({
      buildId, actorUserId: build.createdById, lastAttemptAt: lastAttempt?.createdAt ?? null, retryIntervalMs,
    });
  } catch (error) {
    const { getErrorMessage } = await import("@/lib/shared/get-error-message");
    logger.error("[auto-complete] PR retry failed for %s: %s", buildId, getErrorMessage(error));
    // BI-93CB58D6: a retry that throws was only in the server log, so the build
    // looked idle for ten hours while every hourly retry failed. Put it on the
    // trail; the row also spaces the next retry by SHIP_PR_RETRY_MS.
    const { prisma } = await import("@dpf/db");
    await prisma.buildActivity.create({ data: { buildId, tool: "auto_open_pr",
      summary: `Pull request not opened; the attempt failed: ${getErrorMessage(error).slice(0, 400)}` } }).catch(() => {});
    return "blocked";
  }
}

async function productionDeps(forBuildId: string): Promise<AutoPrDeps> {
  const { prisma } = await import("@dpf/db");
  return {
    phaseOf: async (buildId) => (await prisma.featureBuild.findUnique({ where: { buildId }, select: { phase: true } }))?.phase ?? null,
    existingPrUrl: async (buildId) => {
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { id: true } });
      if (!build) return null;
      const room = await prisma.workroom.findFirst({
        where: { featureBuildId: build.id, pullRequestUrl: { not: null } },
        select: { pullRequestUrl: true },
      });
      return room?.pullRequestUrl ?? null;
    },
    publishedIncomplete: async (buildId) => {
      try {
        const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { id: true, diffPatch: true } });
        if (!build?.diffPatch) return false;
        const already = await prisma.buildActivity.findFirst({
          where: { buildId, tool: "auto_open_pr", summary: { startsWith: REPUBLISHED_PREFIX } },
          select: { id: true },
        });
        if (already) return false;
        const room = await prisma.workroom.findFirst({
          where: { featureBuildId: build.id, pullRequestUrl: { not: null } },
          select: { repositoryFullName: true, headSha: true },
        });
        if (!room?.repositoryFullName || !room.headSha) return false;
        const { resolveGithubToken } = await import("@/lib/contributor-change-lanes/github-rest-reader");
        const token = await resolveGithubToken(prisma as unknown as Parameters<typeof resolveGithubToken>[0]);
        if (!token) return false;
        const { parseFileOperations } = await import("./github-api-commit");
        const { withConnectRetry } = await import("@/lib/network/connect-retry");
        const response = await withConnectRetry(() => fetch(
          `https://api.github.com/repos/${room.repositoryFullName}/commits/${room.headSha}`,
          { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } },
        ));
        if (!response.ok) return false;
        const commit = (await response.json()) as { files?: Array<{ filename: string }> };
        if (!commit.files) return false;
        const changePaths = parseFileOperations(build.diffPatch).map((op) => op.path);
        return missingPublishedPaths(changePaths, commit.files.map((file) => file.filename)).length > 0;
      } catch {
        return false; // could not tell; leave the pull request as it is
      }
    },
    followUpPending: async (buildId) => (await import("./pr-ci-follow-up")).hasPendingPrFollowUp(buildId),
    followUpUnchanged: async (buildId, detail) => (await import("./pr-ci-follow-up")).escalateUnchangedPrRepair(buildId, detail),
    createPr: async (buildId, actorUserId) => {
      const { executeTool } = await import("@/lib/mcp-tools");
      // Name the build in params: context.featureBuildId is read as a row cuid, so an FB- id there sets no hint.
      return executeTool("create_portal_pr", { buildId }, actorUserId, { featureBuildId: buildId, routeContext: "/build" });
    },
    log: async (summary) => {
      await prisma.buildActivity.create({ data: { buildId: forBuildId, tool: "auto_open_pr", summary } }).catch(() => {});
    },
  };
}
