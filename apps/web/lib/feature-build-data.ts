// apps/web/lib/feature-build-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow, FeatureBrief, BuildPhase } from "./feature-build-types";

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
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((r) => ({
    ...r,
    brief: r.brief as FeatureBrief | null,
    plan: r.plan as Record<string, unknown> | null,
    phase: r.phase as BuildPhase,
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
