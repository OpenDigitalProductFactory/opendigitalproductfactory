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
      return executeTool("create_portal_pr", {}, actorUserId, { featureBuildId: buildId, routeContext: "/build" });
    },
    log: async (summary) => {
      await prisma.buildActivity.create({ data: { buildId: forBuildId, tool: "auto_open_pr", summary } }).catch(() => {});
    },
  };
}
