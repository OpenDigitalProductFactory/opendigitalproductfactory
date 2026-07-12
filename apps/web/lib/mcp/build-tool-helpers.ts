import { prisma, type Prisma } from "@dpf/db";
import { mergeHappyPathStateIntoPlan } from "@/lib/feature-build-types";

// Shared Build Studio tool helpers. Previously defined inline in mcp-tools.ts
// and replicated verbatim into several ToolPacks (model-provider, taxonomy-
// archetype, discovery, backlog, …) as those domains drained out of the
// executeTool switch (EP-8DC217EB BET-4). Extracted here so the inline switch,
// the drained packs, and the remaining build/sandbox packs share ONE copy
// rather than N replicas.

/** Fire-and-forget: log tool activity for the Build Studio activity timeline. */
export function logBuildActivity(buildId: string, tool: string, summary: string): void {
  prisma.buildActivity.create({ data: { buildId, tool, summary } }).catch(() => {});
}

/**
 * Phases that exclude a FeatureBuild from "active" auto-resolution.
 * `abandoned` is included because abandoned builds from prior runs would
 * otherwise shadow the freshly promoted build (BI-E9CD1B92, 2026-05-13).
 */
export const TERMINAL_BUILD_PHASES = ["complete", "failed", "abandoned"] as const;

/**
 * Pull a well-formed `buildId` hint out of a tool's params bag.
 * Returns null when the hint is missing, non-string, or doesn't have the
 * `FB-` prefix that all real FeatureBuild IDs carry.
 */
export function extractBuildIdHint(params: Record<string, unknown>): string | null {
  const v = params["buildId"];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.startsWith("FB-") ? trimmed : null;
}

/**
 * Resolve the active FeatureBuild for the current user.
 *
 * When `buildIdHint` is supplied AND it resolves to an existing build the
 * caller is allowed to act on, that hint wins — even if the user has a more
 * recently updated build. This is how explicit `buildId` arguments from MCP
 * tool calls reach the per-tool handlers without being silently overridden
 * (the bug behind FB-1D69766D returning FB-72EB9C06's review).
 *
 * Fallback: most-recently-updated non-terminal build created by the user.
 */
export async function resolveActiveBuildId(
  userId: string,
  buildIdHint?: string | null,
): Promise<string | null> {
  if (buildIdHint && buildIdHint.startsWith("FB-")) {
    const hinted = await prisma.featureBuild.findUnique({
      where: { buildId: buildIdHint },
      select: { buildId: true, createdById: true },
    });
    // Access model today is owner-only — see getFeatureBuildForContext for the
    // matching check. If a future grant model lands, expand this predicate.
    if (hinted && hinted.createdById === userId) return hinted.buildId;
  }
  const build = await prisma.featureBuild.findFirst({
    where: { createdById: userId, phase: { notIn: [...TERMINAL_BUILD_PHASES] } },
    orderBy: { updatedAt: "desc" },
    select: { buildId: true },
  });
  return build?.buildId ?? null;
}

export async function updateBuildHappyPathState(
  userId: string,
  patch: Parameters<typeof mergeHappyPathStateIntoPlan>[1],
  buildId?: string | null,
): Promise<void> {
  const resolvedBuildId = buildId ?? await resolveActiveBuildId(userId);
  if (!resolvedBuildId) return;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId: resolvedBuildId },
    select: { plan: true },
  });
  if (!build) return;

  const mergedPlan = mergeHappyPathStateIntoPlan(
    (build.plan as Record<string, unknown> | null) ?? null,
    patch,
  );

  await prisma.featureBuild.update({
    where: { buildId: resolvedBuildId },
    data: { plan: mergedPlan as Prisma.InputJsonValue },
  });
}
