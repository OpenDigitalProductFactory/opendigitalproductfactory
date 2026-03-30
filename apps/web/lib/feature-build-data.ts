// apps/web/lib/feature-build-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow, FeatureBrief, BuildPhase, BuildDesignDoc, ReviewResult, BuildPlanDoc, TaskResult, VerificationOutput, AcceptanceCriterion } from "./feature-build-types";
import type { BuildContext } from "./build-agent-prompts";
import type { AttachmentInfo } from "./agent-coworker-types";

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
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      taskResults: true,
      verificationOut: true,
      acceptanceMet: true,
      accountableEmployeeId: true,
      claimedByAgentId: true,
      claimedAt: true,
      claimStatus: true,
      uxTestResults: true,
      buildExecState: true,
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
    designDoc: r.designDoc as BuildDesignDoc | null,
    designReview: r.designReview as ReviewResult | null,
    buildPlan: r.buildPlan as BuildPlanDoc | null,
    planReview: r.planReview as ReviewResult | null,
    taskResults: r.taskResults as TaskResult[] | null,
    verificationOut: r.verificationOut as VerificationOutput | null,
    acceptanceMet: r.acceptanceMet as AcceptanceCriterion[] | null,
    uxTestResults: r.uxTestResults as FeatureBuildRow["uxTestResults"],
    buildExecState: r.buildExecState as FeatureBuildRow["buildExecState"],
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
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      taskResults: true,
      verificationOut: true,
      acceptanceMet: true,
      accountableEmployeeId: true,
      claimedByAgentId: true,
      claimedAt: true,
      claimStatus: true,
      uxTestResults: true,
      buildExecState: true,
      digitalProduct: {
        select: {
          productId: true,
          version: true,
          _count: { select: { backlogItems: true } },
        },
      },
    },
  });

  if (!r) return null;

  return {
    ...r,
    brief: r.brief as FeatureBrief | null,
    plan: r.plan as Record<string, unknown> | null,
    phase: r.phase as BuildPhase,
    designDoc: r.designDoc as BuildDesignDoc | null,
    designReview: r.designReview as ReviewResult | null,
    buildPlan: r.buildPlan as BuildPlanDoc | null,
    planReview: r.planReview as ReviewResult | null,
    taskResults: r.taskResults as TaskResult[] | null,
    verificationOut: r.verificationOut as VerificationOutput | null,
    acceptanceMet: r.acceptanceMet as AcceptanceCriterion[] | null,
    uxTestResults: r.uxTestResults as FeatureBuildRow["uxTestResults"],
    buildExecState: r.buildExecState as FeatureBuildRow["buildExecState"],
    product: r.digitalProduct
      ? { productId: r.digitalProduct.productId, version: r.digitalProduct.version, backlogCount: r.digitalProduct._count.backlogItems }
      : null,
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
      plan: true,
      portfolioId: true,
      createdById: true,
    },
  });

  if (!r || r.createdById !== userId) return null;

  // Load contribution mode for ship phase context injection
  let contributionMode: string | undefined;
  if (r.phase === "ship") {
    const devConfig = await prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { contributionMode: true },
    });
    contributionMode = devConfig?.contributionMode ?? "selective";
  }

  return {
    buildId: r.buildId,
    phase: r.phase as BuildPhase,
    title: r.title,
    brief: r.brief as FeatureBrief | null,
    plan: r.plan as Record<string, unknown> | null,
    portfolioId: r.portfolioId,
    contributionMode,
  };
}

export const getThreadAttachments = cache(async (threadId: string): Promise<AttachmentInfo[]> => {
  const rows = await prisma.agentAttachment.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
  });
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    parsedSummary: (r.parsedContent as { summary?: string } | null)?.summary ?? null,
  }));
});
