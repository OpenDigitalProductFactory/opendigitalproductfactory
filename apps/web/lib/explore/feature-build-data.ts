// apps/web/lib/feature-build-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow, FeatureBrief, BuildPhase, BuildDesignDoc, ReviewResult, BuildPlanDoc, TaskResult, VerificationOutput, AcceptanceCriterion, BuildDeliberationSummary } from "./feature-build-types";
import { normalizeHappyPathState } from "./feature-build-types";
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
      uxVerificationStatus: true,
      sandboxVerification: true,
      sandboxVerificationStatus: true,
      buildExecState: true,
      scoutFindings: true,
      deliberationSummary: true,
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
    uxVerificationStatus: r.uxVerificationStatus as FeatureBuildRow["uxVerificationStatus"],
    sandboxVerification: r.sandboxVerification as FeatureBuildRow["sandboxVerification"],
    sandboxVerificationStatus: r.sandboxVerificationStatus as FeatureBuildRow["sandboxVerificationStatus"],
    buildExecState: r.buildExecState as FeatureBuildRow["buildExecState"],
    scoutFindings: r.scoutFindings as FeatureBuildRow["scoutFindings"],
    deliberationSummary: r.deliberationSummary as BuildDeliberationSummary | null,
    happyPathState: normalizeHappyPathState((r.plan as Record<string, unknown> | null)?.happyPathState ?? null),
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
      uxVerificationStatus: true,
      sandboxVerification: true,
      sandboxVerificationStatus: true,
      buildExecState: true,
      scoutFindings: true,
      deliberationSummary: true,
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
    uxVerificationStatus: r.uxVerificationStatus as FeatureBuildRow["uxVerificationStatus"],
    sandboxVerification: r.sandboxVerification as FeatureBuildRow["sandboxVerification"],
    sandboxVerificationStatus: r.sandboxVerificationStatus as FeatureBuildRow["sandboxVerificationStatus"],
    buildExecState: r.buildExecState as FeatureBuildRow["buildExecState"],
    scoutFindings: r.scoutFindings as FeatureBuildRow["scoutFindings"],
    deliberationSummary: r.deliberationSummary as BuildDeliberationSummary | null,
    happyPathState: normalizeHappyPathState((r.plan as Record<string, unknown> | null)?.happyPathState ?? null),
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
      scoutFindings: true,
      phaseHandoffs: {
        orderBy: { createdAt: "asc" },
        select: {
          fromPhase: true,
          toPhase: true,
          summary: true,
          decisionsMade: true,
          openIssues: true,
          userPreferences: true,
          compressedSummary: true,
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
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: r.portfolioId },
      select: { name: true },
    });
    if (portfolio) {
      taxonomyContext = { path: portfolio.name, siblingProducts: [] };
    }
  }

  // Pre-resolve the brand design system so the ideate agent has design
  // recommendations without needing to call generate_design_system as a tool.
  // readBrandContext reads the single Org's designSystem first (structured),
  // falls back to any storefront's legacy markdown blob.
  let designSystem: string | undefined;
  try {
    const { readBrandContext } = await import("@/lib/brand/read");
    const ctx = await readBrandContext({});
    if (ctx.structured) {
      const s = ctx.structured;
      designSystem = `Brand: ${s.identity.name}\nPrimary color: ${s.palette.primary}\nBody font: ${s.typography.families.sans}\nConfidence: ${(s.confidence.overall * 100).toFixed(0)}%\n---\n${JSON.stringify(s, null, 2).slice(0, 3000)}`;
    } else if (ctx.legacyMarkdown) {
      designSystem = ctx.legacyMarkdown;
    }
  } catch {
    // Non-fatal — proceed without brand context
  }

  if (!designSystem) {
    try {
      const { generateDesignSystem } = await import("@/lib/design-intelligence");
      const brief = r.brief as { description?: string; title?: string } | null;
      const query = brief?.description ?? brief?.title ?? r.title;
      if (query) {
        designSystem = generateDesignSystem(query, r.title ?? undefined);
      }
    } catch {
      // Non-fatal — proceed without generated design system
    }
  }

  // Load business context so the AI Coworker understands the organization
  let businessContext: string | undefined;
  try {
    const bc = await prisma.businessContext.findFirst({
      select: {
        description: true,
        valueProposition: true,
        targetMarket: true,
        customerSegments: true,
        revenueModel: true,
        companySize: true,
        geographicScope: true,
        industry: true,
        ctaType: true,
      },
    });
    if (bc) {
      const lines: string[] = [];
      if (bc.industry) lines.push(`Industry: ${bc.industry.replace(/-/g, " ")}`);
      if (bc.description) lines.push(`What they do: ${bc.description}`);
      if (bc.valueProposition) lines.push(`Differentiator: ${bc.valueProposition}`);
      if (bc.targetMarket) lines.push(`Target market: ${bc.targetMarket}`);
      if (bc.customerSegments?.length) lines.push(`Customer segments: ${bc.customerSegments.join(", ")}`);
      if (bc.revenueModel) lines.push(`Revenue model: ${bc.revenueModel}`);
      if (bc.ctaType) lines.push(`Primary CTA: ${bc.ctaType}`);
      if (bc.companySize) lines.push(`Company size: ${bc.companySize}`);
      if (bc.geographicScope) lines.push(`Geographic scope: ${bc.geographicScope}`);
      if (lines.length > 0) businessContext = lines.join("\n");
    }
  } catch {
    // Non-fatal — proceed without business context
  }

  // Format scout findings if available
  let scoutFindings: string | undefined;
  if (r.scoutFindings) {
    try {
      const scout = r.scoutFindings as Record<string, unknown>;
      const lines: string[] = [];

      const relatedModels = scout.relatedModels as Array<{ name: string; file: string; line: number }> | undefined;
      if (relatedModels && relatedModels.length > 0) {
        lines.push("Related models found in codebase:");
        relatedModels.forEach((m) => {
          lines.push(`  - ${m.name} (${m.file}:${m.line})`);
        });
      }

      const gaps = scout.gaps as Array<{ entity: string; reason: string }> | undefined;
      if (gaps && gaps.length > 0) {
        lines.push("");
        lines.push("Gaps (concepts not yet modeled):");
        gaps.forEach((g) => {
          lines.push(`  - ${g.entity}: ${g.reason}`);
        });
      }

      const externalStructure = scout.externalStructure as Record<string, unknown> | undefined;
      if (externalStructure) {
        lines.push("");
        lines.push(`External URL: ${externalStructure.url}`);
        const sections = externalStructure.sections as Array<{ heading: string }> | undefined;
        if (sections && sections.length > 0) {
          lines.push(`  Sections found: ${sections.map((s) => s.heading).join(", ")}`);
        }
      }

      const suggestedQuestions = scout.suggestedQuestions as string[] | undefined;
      if (suggestedQuestions && suggestedQuestions.length > 0) {
        lines.push("");
        lines.push("Suggested clarification questions:");
        suggestedQuestions.forEach((q) => {
          lines.push(`  - ${q}`);
        });
      }

      const complexity = scout.estimatedComplexity as string | undefined;
      const reason = scout.complexityReason as string | undefined;
      if (complexity && reason) {
        lines.push("");
        lines.push(`Estimated complexity: ${complexity} — ${reason}`);
      }

      const effort = scout.estimatedEffort as string | undefined;
      const effortReason = scout.effortReason as string | undefined;
      const executionApproach = scout.executionApproach as string | undefined;
      if (effort && effortReason) {
        lines.push(`Estimated effort: ${effort} — ${effortReason}`);
        if (executionApproach === "epic-decompose") {
          lines.push("⚠️ NOTE: This feature appears large enough to decompose into an Epic with 3-5 builds. After design approval, consider breaking it into smaller feature builds for faster iteration.");
        }
      }

      if (lines.length > 0) {
        scoutFindings = lines.join("\n");
      }
    } catch {
      // Non-fatal — proceed without formatted scout findings
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
    designSystem,
    businessContext,
    scoutFindings,
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
