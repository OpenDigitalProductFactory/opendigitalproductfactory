"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

export async function getFeatureBuild(buildId: string): Promise<FeatureBuildRow | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    include: {
      digitalProduct: { select: { productId: true, version: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
      phaseHandoffs: { orderBy: { createdAt: "asc" }, select: { fromPhase: true, toPhase: true, fromAgentId: true, toAgentId: true, summary: true, decisionsMade: true, openIssues: true, userPreferences: true, compressedSummary: true, evidenceDigest: true, createdAt: true } },
    },
  });

  if (!build || build.createdById !== session.user.id) return null;

  return {
    ...build,
    brief: build.brief as FeatureBuildRow["brief"],
    plan: build.plan as FeatureBuildRow["plan"],
    phase: build.phase as FeatureBuildRow["phase"],
    designDoc: build.designDoc as FeatureBuildRow["designDoc"],
    designReview: build.designReview as FeatureBuildRow["designReview"],
    buildPlan: build.buildPlan as FeatureBuildRow["buildPlan"],
    planReview: build.planReview as FeatureBuildRow["planReview"],
    taskResults: build.taskResults as FeatureBuildRow["taskResults"],
    verificationOut: build.verificationOut as FeatureBuildRow["verificationOut"],
    acceptanceMet: build.acceptanceMet as FeatureBuildRow["acceptanceMet"],
    product: build.digitalProduct
      ? { productId: build.digitalProduct.productId, version: build.digitalProduct.version, backlogCount: 0 }
      : null,
    phaseHandoffs: build.phaseHandoffs.map(h => ({
      ...h,
      evidenceDigest: h.evidenceDigest as Record<string, string>,
    })),
  } as FeatureBuildRow;
}
