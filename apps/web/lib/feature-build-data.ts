// apps/web/lib/feature-build-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow, FeatureBrief, BuildPhase } from "./feature-build-types";
import type { BuildContext } from "./build-agent-prompts";

export const getFeatureBuilds = cache(async (userId: string): Promise<FeatureBuildRow[]> => {
  const rows = await prisma.featureBuild.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      buildId: true,
      title: true,
      description: true,
      portfolioId: true,
      brief: true,
      plan: true,
      phase: true,
      sandboxId: true,
      sandboxPort: true,
      diffSummary: true,
      diffPatch: true,
      codingProvider: true,
      threadId: true,
      digitalProductId: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      digitalProduct: {
        select: {
          productId: true,
          version: true,
          _count: { select: { backlogItems: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    ...r,
    brief: r.brief as FeatureBrief | null,
    plan: r.plan as Record<string, unknown> | null,
    phase: r.phase as BuildPhase,
    product: r.digitalProduct
      ? { productId: r.digitalProduct.productId, version: r.digitalProduct.version, backlogCount: r.digitalProduct._count.backlogItems }
      : null,
  }));
});

export const getFeatureBuildById = cache(async (buildId: string): Promise<FeatureBuildRow | null> => {
  const r = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      buildId: true,
      title: true,
      description: true,
      portfolioId: true,
      brief: true,
      plan: true,
      phase: true,
      sandboxId: true,
      sandboxPort: true,
      diffSummary: true,
      diffPatch: true,
      codingProvider: true,
      threadId: true,
      digitalProductId: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!r) return null;

  return {
    ...r,
    brief: r.brief as FeatureBrief | null,
    plan: r.plan as Record<string, unknown> | null,
    phase: r.phase as BuildPhase,
  };
});

// Note: For portfolio select dropdowns, reuse getPortfoliosForSelect() from
// "@/lib/backlog-data" (returns { id, slug, name }). No duplicate needed here.

export type CodingProviderOption = {
  providerId: string;
  modelId: string;
  friendlyName: string;
  codingCapability: string;
};

export const getCodingProviders = cache(async (): Promise<CodingProviderOption[]> => {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      codingCapability: { not: null },
      NOT: { codingCapability: "insufficient" },
    },
    orderBy: [{ codingCapability: "desc" }, { costTier: "asc" }],
    select: {
      providerId: true,
      modelId: true,
      friendlyName: true,
      codingCapability: true,
    },
  });

  return profiles.map((p) => ({
    ...p,
    codingCapability: p.codingCapability ?? "unknown",
  }));
});

/** Fetch minimal build context for prompt injection. NOT cached — must be fresh per message. */
export async function getFeatureBuildForContext(
  buildId: string,
  userId: string,
): Promise<BuildContext | null> {
  const r = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      buildId: true,
      title: true,
      phase: true,
      brief: true,
      portfolioId: true,
      createdById: true,
    },
  });

  if (!r || r.createdById !== userId) return null;

  return {
    buildId: r.buildId,
    phase: r.phase as BuildPhase,
    title: r.title,
    brief: r.brief as FeatureBrief | null,
    portfolioId: r.portfolioId,
  };
}
