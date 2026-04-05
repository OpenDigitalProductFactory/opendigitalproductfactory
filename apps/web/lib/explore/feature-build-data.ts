// apps/web/lib/feature-build-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow, FeatureBrief, BuildPhase, BuildDesignDoc, ReviewResult, BuildPlanDoc, TaskResult, VerificationOutput, AcceptanceCriterion } from "./feature-build-types";
import type { BuildContext } from "@/lib/build-agent-prompts";
import type { AttachmentInfo } from "@/lib/agent-coworker-types";

export const getFeatureBuilds = cache(async (userId: string): Promise<FeatureBuildRow[]> => {
  const rows = await prisma.featureBuild.findMany({
    where: { createdById: userId, phase: { not: "failed" } },
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
    phaseHandoffs: null,
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
    phaseHandoffs: null,
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
      phaseHandoffs: {
        orderBy: { createdAt: "asc" },
        select: {
          fromPhase: true,
          toPhase: true,
          summary: true,
          decisionsMade: true,
          openIssues: true,
          userPreferences: true,
        },
      },
    },
  });

  if (!r || r.createdById !== userId) return null;

  // Load contribution mode for all phases — agent needs awareness early
  // (e.g., contribute_all mode should flag proprietary designs in ideate)
  const devConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { contributionMode: true },
  });
  const contributionMode = devConfig?.contributionMode ?? "policy_pending";

  // Resolve taxonomy path and sibling products for richer context
  let taxonomyContext: { path: string; siblingProducts: string[] } | undefined;
  const taxonomyAttr = (await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { taxonomyAttribution: true },
  }))?.taxonomyAttribution as { confirmedNodeId?: string } | null;

  if (taxonomyAttr?.confirmedNodeId) {
    // Walk the taxonomy tree upward to build the full path
    const pathParts: string[] = [];
    let currentNodeId: string | null = taxonomyAttr.confirmedNodeId;
    while (currentNodeId) {
      const node: { name: string; parentId: string | null } | null = await prisma.taxonomyNode.findUnique({
        where: { id: currentNodeId },
        select: { name: true, parentId: true },
      });
      if (!node) break;
      pathParts.unshift(node.name);
      currentNodeId = node.parentId;
    }
    // Find sibling products in the same taxonomy node
    const siblings = await prisma.digitalProduct.findMany({
      where: { taxonomyNodeId: taxonomyAttr.confirmedNodeId },
      select: { name: true },
      take: 10,
    });
    taxonomyContext = {
      path: pathParts.join(" > "),
      siblingProducts: siblings.map((s) => s.name),
    };
  } else if (r.portfolioId) {
    // Fallback: resolve portfolio name at minimum
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: r.portfolioId },
      select: { name: true },
    });
    if (portfolio) {
      taxonomyContext = { path: portfolio.name, siblingProducts: [] };
    }
  }

  return {
    buildId: r.buildId,
    phase: r.phase as BuildPhase,
    title: r.title,
    brief: r.brief as FeatureBrief | null,
    plan: r.plan as Record<string, unknown> | null,
    portfolioId: r.portfolioId,
    contributionMode,
    phaseHandoffs: r.phaseHandoffs,
    taxonomyContext,
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
