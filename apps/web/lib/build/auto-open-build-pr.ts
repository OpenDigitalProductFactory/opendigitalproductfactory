// apps/web/lib/build/auto-open-build-pr.ts
//
// BI-D80F2EA0 — founder decision (2026-09-25): once review passes and the build
// reaches ship, Build Studio opens its PR itself instead of waiting for a human
// click. create_portal_pr keeps every publication guard (verification readiness,
// the preflight record for the exact tree); a refusal is recorded on the build.
// A PR is not a merge: required checks, the merge queue and human review still
// decide what lands.

export type AutoPrDeps = {
  phaseOf: (buildId: string) => Promise<string | null>;
  existingPrUrl: (buildId: string) => Promise<string | null>;
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
  if (await deps.existingPrUrl(input.buildId)) return "skipped";
  const result = await deps.createPr(input.buildId, input.actorUserId);
  const detail = String(result.message ?? result.error ?? "").slice(0, 400);
  if (result.success) {
    await deps.log(`Opened the pull request automatically after review: ${detail}`);
    return "opened";
  }
  await deps.log(`Pull request not opened; a publication guard refused: ${detail}`);
  return "blocked";
}

/** How long a refused PR attempt stands before the ship reconciler tries again. */
export const SHIP_PR_RETRY_MS = 60 * 60 * 1000;

/**
 * The PR is opened once, at review->ship. A refusal there (a guard, a stale
 * sandbox, a since-fixed defect) left the build in ship with no PR and nothing
 * to try again. The ship reconciler calls this for each ship build: it retries
 * at most once per SHIP_PR_RETRY_MS, and openBuildStudioPrAfterShip itself skips
 * a build that already has its PR.
 */
export async function retryBuildStudioPrForShipBuild(input: {
  buildId: string;
  actorUserId: string;
  lastAttemptAt: Date | null;
  now?: Date;
  deps?: AutoPrDeps;
}): Promise<"opened" | "blocked" | "skipped"> {
  const now = input.now ?? new Date();
  if (input.lastAttemptAt && now.getTime() - input.lastAttemptAt.getTime() < SHIP_PR_RETRY_MS) return "skipped";
  return openBuildStudioPrAfterShip({ buildId: input.buildId, actorUserId: input.actorUserId, deps: input.deps });
}

/**
 * The ship reconciler's hook: reads the build's owner and its last PR attempt,
 * then retries. Never throws; a failure is logged and the next tick tries again.
 */
export async function retryPrForShipBuild(buildId: string, logger: Pick<Console, "error">): Promise<void> {
  try {
    const { prisma } = await import("@dpf/db");
    const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { createdById: true } });
    if (!build?.createdById) return;
    const lastAttempt = await prisma.buildActivity.findFirst({
      where: { buildId, tool: "auto_open_pr" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    await retryBuildStudioPrForShipBuild({ buildId, actorUserId: build.createdById, lastAttemptAt: lastAttempt?.createdAt ?? null });
  } catch (error) {
    const { getErrorMessage } = await import("@/lib/shared/get-error-message");
    logger.error("[auto-complete] PR retry failed for %s: %s", buildId, getErrorMessage(error));
  }
}

type ExecuteTool = (typeof import("@/lib/mcp-tools"))["executeTool"];

/**
 * Name the build in the tool's params. create_portal_pr resolves its build from
 * params only; the execution context's featureBuildId never reaches it. With no
 * buildId the tool falls back to "the owner's only open build" and refuses when
 * there are several, so FB-2E891686, the first build to reach ship unattended
 * (2026-10-08), got "No active build" and no PR (BI-1CC992A5's class).
 */
export function createPortalPrForBuild(executeTool: ExecuteTool, buildId: string, actorUserId: string) {
  return executeTool("create_portal_pr", { buildId }, actorUserId, { featureBuildId: buildId, routeContext: "/build" });
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
    createPr: async (buildId, actorUserId) => {
      const { executeTool } = await import("@/lib/mcp-tools");
      return createPortalPrForBuild(executeTool, buildId, actorUserId);
    },
    log: async (summary) => {
      await prisma.buildActivity.create({ data: { buildId: forBuildId, tool: "auto_open_pr", summary } }).catch(() => {});
    },
  };
}
