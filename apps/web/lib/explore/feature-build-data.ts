// apps/web/lib/feature-build-data.ts
import { cache } from "react";
import { Prisma, prisma } from "@dpf/db";
import type { FeatureBuildRow, FeatureBrief, BuildPhase, BuildDesignDoc, ReviewResult, BuildPlanDoc, TaskResult, VerificationOutput, AcceptanceCriterion, BuildDeliberationSummary } from "./feature-build-types";
import { normalizeHappyPathState } from "./feature-build-types";
import type { BuildContext } from "@/lib/build-agent-prompts";
import type { AttachmentInfo } from "@/lib/agent-coworker-types";
import { deriveEpicRollup, type EpicRollupView } from "@/lib/build/epic-rollup";
import { PLAN_READINESS_DOMAIN_CLASS } from "@/lib/decision-perspective/types";
import {
  DECISION_INTERACTION_GATE_SELECT,
  decisionInteractionRowToGateView,
} from "@/lib/decision-perspective/view-model";
import {
  BUSINESS_BUILD_BRIEF_RECORD_SELECT,
  businessBuildBriefFromRecord,
} from "@/lib/build/business-build-brief";
import {
  OWNER_CHANGE_EVIDENCE_REVISION_QUERY,
  ownerEvidenceObservedAtFromRevisions,
} from "@/lib/build/owner-change-evidence";

const EXECUTION_EPIC_ROLLUP_SELECT = {
  id: true,
  epicId: true,
  title: true,
  updatedAt: true,
  originatingBacklogItemId: true,
  items: {
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      itemId: true,
      title: true,
      status: true,
    },
  },
  originatingBacklogItem: {
    select: {
      id: true,
      itemId: true,
      title: true,
      status: true,
    },
  },
  featureBuilds: {
    orderBy: [{ childOrder: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      buildId: true,
      title: true,
      phase: true,
      childOrder: true,
      updatedAt: true,
    },
  },
  dependencies: {
    select: {
      dependentBuildId: true,
      dependsOnBuildId: true,
    },
  },
} satisfies Prisma.EpicSelect;

type ExecutionEpicRollupRow = Prisma.EpicGetPayload<{
  select: typeof EXECUTION_EPIC_ROLLUP_SELECT;
}>;

export const getFeatureBuilds = cache(async (userId: string): Promise<FeatureBuildRow[]> => {
  // Build Studio is internal-cockpit-only and DPF is single-org-per-install
  // (per project memory `single_org_per_install`). All authenticated users on
  // this install belong to the same Org and have full visibility into Org-
  // scoped build work. Filtering by createdById hid builds promoted via MCP
  // under a different identity from the portal-logged-in user (BI-AA03296D),
  // which broke the natural cross-identity workflow of MCP-driven promotion +
  // portal-driven supervision. The userId param is retained for backwards
  // compatibility (and so cache keys remain user-scoped) but no longer used
  // as a filter. The per-build authorization check in
  // apps/web/lib/actions/build-read.ts:getFeatureBuild was relaxed in the same
  // PR for the same reason.
  void userId;
  const rows = await prisma.featureBuild.findMany({
    where: {
      phase: { not: "failed" },
      // Hide abandoned builds from the fleet — they are dead/cleaned-up work
      // and otherwise clutter the queue as if they were unfinished efforts.
      abandonedAt: null,
      parentEpicId: null,
      supersededByEpicId: null,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      buildId: true,
      title: true,
      description: true,
      portfolioId: true,
      parentEpicId: true,
      originatingBacklogItemId: true,
      brief: true,
      businessBuildBrief: { select: BUSINESS_BUILD_BRIEF_RECORD_SELECT },
      artifactRevisions: OWNER_CHANGE_EVIDENCE_REVISION_QUERY,
      plan: true,
      phase: true,
      sandboxId: true,
      sandboxPort: true,
      diffSummary: true,
      diffPatch: true,
      codingProvider: true,
      threadId: true,
      digitalProductId: true,
      disposition: true,
      dispositionReason: true,
      dispositionSuggested: true,
      dispositionSuggestionReason: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      draftApprovedAt: true,
      abandonReason: true,
      abandonedAt: true,
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
      buildExecState: true,
      taxonomyAttribution: true,
      scoutFindings: true,
      deliberationSummary: true,
      digitalProduct: {
        select: {
          productId: true,
          version: true,
          _count: { select: { backlogItems: true } },
        },
      },
      originator: {
        select: {
          id: true,
          itemId: true,
          title: true,
          status: true,
          triageOutcome: true,
          effortSize: true,
          proposedOutcome: true,
          activeBuildId: true,
          resolution: true,
          abandonReason: true,
        },
      },
      decisionInteractions: {
        where: {
          phaseFrom: "plan",
          phaseTo: "build",
          domainClass: PLAN_READINESS_DOMAIN_CLASS,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: DECISION_INTERACTION_GATE_SELECT,
      },
    },
  });

  return rows.map((r) => {
    const { artifactRevisions, ...row } = r;
    return {
      ...row,
      brief: r.brief as FeatureBrief | null,
      businessBuildBrief: r.businessBuildBrief
        ? businessBuildBriefFromRecord({ title: r.title, row: r.businessBuildBrief })
        : null,
      evidenceObservedAt: ownerEvidenceObservedAtFromRevisions(artifactRevisions),
      plan: r.plan as Record<string, unknown> | null,
      phase: r.phase as BuildPhase,
      draftApprovedAt: r.draftApprovedAt,
      designDoc: r.designDoc as BuildDesignDoc | null,
      designReview: r.designReview as ReviewResult | null,
      buildPlan: r.buildPlan as BuildPlanDoc | null,
      planReview: r.planReview as ReviewResult | null,
      taskResults: r.taskResults as TaskResult[] | null,
      verificationOut: r.verificationOut as VerificationOutput | null,
      acceptanceMet: r.acceptanceMet as AcceptanceCriterion[] | null,
      uxTestResults: r.uxTestResults as FeatureBuildRow["uxTestResults"],
      uxVerificationStatus: r.uxVerificationStatus as FeatureBuildRow["uxVerificationStatus"],
      buildExecState: r.buildExecState as FeatureBuildRow["buildExecState"],
      taxonomyAttribution: r.taxonomyAttribution as FeatureBuildRow["taxonomyAttribution"],
      scoutFindings: r.scoutFindings as FeatureBuildRow["scoutFindings"],
      deliberationSummary: r.deliberationSummary as BuildDeliberationSummary | null,
      happyPathState: normalizeHappyPathState((r.plan as Record<string, unknown> | null)?.happyPathState ?? null),
      product: r.digitalProduct
        ? { productId: r.digitalProduct.productId, version: r.digitalProduct.version, backlogCount: r.digitalProduct._count.backlogItems }
        : null,
      originator: r.originator,
      phaseHandoffs: null,
      decisionInteraction: decisionInteractionRowToGateView(r.decisionInteractions[0] ?? null),
    };
  });
});

export const getExecutionEpicRollups = cache(async (userId: string): Promise<EpicRollupView[]> => {
  void userId;
  const rows = await prisma.epic.findMany({
    where: {
      designDoc: { not: Prisma.DbNull },
      featureBuilds: { some: {} },
    },
    orderBy: { updatedAt: "desc" },
    select: EXECUTION_EPIC_ROLLUP_SELECT,
  }) as ExecutionEpicRollupRow[];

  return rows.map((row) => {
    const items = [...row.items];
    if (row.originatingBacklogItem && !items.some((item) => item.id === row.originatingBacklogItem?.id)) {
      items.unshift(row.originatingBacklogItem);
    }

    return deriveEpicRollup({
      epic: {
        id: row.id,
        epicId: row.epicId,
        title: row.title,
        updatedAt: row.updatedAt,
        originatingBacklogItemId: row.originatingBacklogItemId,
        items,
        featureBuilds: row.featureBuilds.map((build) => ({
          ...build,
          phase: build.phase as BuildPhase,
        })),
        dependencies: row.dependencies,
      },
    });
  });
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
      parentEpicId: true,
      originatingBacklogItemId: true,
      brief: true,
      businessBuildBrief: { select: BUSINESS_BUILD_BRIEF_RECORD_SELECT },
      artifactRevisions: OWNER_CHANGE_EVIDENCE_REVISION_QUERY,
      plan: true,
      phase: true,
      sandboxId: true,
      sandboxPort: true,
      diffSummary: true,
      diffPatch: true,
      codingProvider: true,
      threadId: true,
      digitalProductId: true,
      disposition: true,
      dispositionReason: true,
      dispositionSuggested: true,
      dispositionSuggestionReason: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      draftApprovedAt: true,
      abandonReason: true,
      abandonedAt: true,
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
      buildExecState: true,
      taxonomyAttribution: true,
      scoutFindings: true,
      deliberationSummary: true,
      digitalProduct: {
        select: {
          productId: true,
          version: true,
          _count: { select: { backlogItems: true } },
        },
      },
      originator: {
        select: {
          id: true,
          itemId: true,
          title: true,
          status: true,
          triageOutcome: true,
          effortSize: true,
          proposedOutcome: true,
          activeBuildId: true,
          resolution: true,
          abandonReason: true,
        },
      },
      decisionInteractions: {
        where: {
          phaseFrom: "plan",
          phaseTo: "build",
          domainClass: PLAN_READINESS_DOMAIN_CLASS,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: DECISION_INTERACTION_GATE_SELECT,
      },
    },
  });

  if (!r) return null;

  const { artifactRevisions, ...row } = r;
  return {
    ...row,
    brief: r.brief as FeatureBrief | null,
    businessBuildBrief: r.businessBuildBrief
      ? businessBuildBriefFromRecord({ title: r.title, row: r.businessBuildBrief })
      : null,
    evidenceObservedAt: ownerEvidenceObservedAtFromRevisions(artifactRevisions),
    plan: r.plan as Record<string, unknown> | null,
    phase: r.phase as BuildPhase,
    draftApprovedAt: r.draftApprovedAt,
    designDoc: r.designDoc as BuildDesignDoc | null,
    designReview: r.designReview as ReviewResult | null,
    buildPlan: r.buildPlan as BuildPlanDoc | null,
    planReview: r.planReview as ReviewResult | null,
    taskResults: r.taskResults as TaskResult[] | null,
    verificationOut: r.verificationOut as VerificationOutput | null,
    acceptanceMet: r.acceptanceMet as AcceptanceCriterion[] | null,
    uxTestResults: r.uxTestResults as FeatureBuildRow["uxTestResults"],
    uxVerificationStatus: r.uxVerificationStatus as FeatureBuildRow["uxVerificationStatus"],
    buildExecState: r.buildExecState as FeatureBuildRow["buildExecState"],
    taxonomyAttribution: r.taxonomyAttribution as FeatureBuildRow["taxonomyAttribution"],
    scoutFindings: r.scoutFindings as FeatureBuildRow["scoutFindings"],
    deliberationSummary: r.deliberationSummary as BuildDeliberationSummary | null,
    happyPathState: normalizeHappyPathState((r.plan as Record<string, unknown> | null)?.happyPathState ?? null),
    product: r.digitalProduct
      ? { productId: r.digitalProduct.productId, version: r.digitalProduct.version, backlogCount: r.digitalProduct._count.backlogItems }
      : null,
    originator: r.originator,
    phaseHandoffs: null,
    decisionInteraction: decisionInteractionRowToGateView(r.decisionInteractions[0] ?? null),
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
      id: true,
      buildId: true,
      title: true,
      phase: true,
      kind: true,
      brief: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      verificationOut: true,
      acceptanceMet: true,
      uxVerificationStatus: true,
      uxTestResults: true,
      plan: true,
      portfolioId: true,
      createdById: true,
      taxonomyAttribution: true,
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
  const taxonomyAttr = r.taxonomyAttribution as { confirmedNodeId?: string } | null;

  if (taxonomyAttr?.confirmedNodeId) {
    const startingNode = await prisma.taxonomyNode.findUnique({
      where: { nodeId: taxonomyAttr.confirmedNodeId },
      select: { id: true, name: true, parentId: true },
    }) ?? await prisma.taxonomyNode.findUnique({
      where: { id: taxonomyAttr.confirmedNodeId },
      select: { id: true, name: true, parentId: true },
    });

    if (startingNode) {
      // Walk the taxonomy tree upward to build the full path. confirmedNodeId is
      // a human-readable nodeId slug; relationships and product links use row ids.
      const pathParts: string[] = [];
      const seen = new Set<string>();
      let node: { id: string; name: string; parentId: string | null } | null = startingNode;
      while (node && !seen.has(node.id)) {
        seen.add(node.id);
        pathParts.unshift(node.name);
        node = node.parentId
          ? await prisma.taxonomyNode.findUnique({
              where: { id: node.parentId },
              select: { id: true, name: true, parentId: true },
            })
          : null;
      }

      // Find sibling products in the same taxonomy node
      const siblings = await prisma.digitalProduct.findMany({
        where: { taxonomyNodeId: startingNode.id },
        select: { name: true },
        take: 10,
      });
      taxonomyContext = {
        path: pathParts.join(" > "),
        siblingProducts: siblings.map((s) => s.name),
      };
    }
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

  // Right-sizing matrix: read the build's processSize from plan.processSize
  // (written at promote time by governed-backlog-tee-up). Default "medium"
  // preserves today's policy cell for builds promoted before this field
  // existed. See docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md
  const planObj = (r.plan as Record<string, unknown> | null) ?? null;
  const processSize = (planObj?.["processSize"] as string | undefined) ?? "medium";

  // Risk-gated intent confirmation (BI-564D68F7): when the business brief is
  // HIGH risk or LOW confidence, surface its open questions so the ideate
  // coworker (STEP 0.4) confirms intent with the operator before research. Any
  // other phase/kind, low-risk + high-confidence, or a missing brief -> the
  // value is undefined and the context + prompt are byte-identical to today.
  // Best-effort: a brief-load error omits the gate rather than blocking ideate.
  let intentConfirmation: string | undefined;
  if ((r.phase as BuildPhase) === "ideate" && (r.kind ?? "feature") === "feature") {
    try {
      const bbb = await prisma.businessBuildBrief.findUnique({
        where: { featureBuildId: r.id },
        select: { riskProfile: true, confidence: true, openQuestions: true },
      });
      if (bbb) {
        const level = (bbb.riskProfile as { level?: string } | null)?.level;
        const lowConfidence = bbb.confidence === "low";
        if (level === "high" || lowConfidence) {
          const questions = (bbb.openQuestions ?? []).filter(Boolean);
          const reason = level === "high" ? "high-risk" : "low-confidence";
          intentConfirmation =
            `This build is ${reason}. Confirm intent with the operator before research.\n` +
            (questions.length > 0
              ? `Open questions to resolve:\n${questions.map((q) => `  - ${q}`).join("\n")}`
              : `No specific open questions — confirm the goal and scope in one sentence before proceeding.`);
        }
      }
    } catch {
      // non-fatal — omit the gate rather than block ideate
    }
  }

  return {
    buildId: r.buildId,
    phase: r.phase as BuildPhase,
    kind: r.kind as import("@/lib/feature-build-types").FeatureBuildKind,
    size: processSize as import("@/lib/feature-build-types").BuildProcessSize,
    title: r.title,
    brief: r.brief as FeatureBrief | null,
    designDoc: r.designDoc as BuildDesignDoc | null,
    designReview: r.designReview as ReviewResult | null,
    buildPlan: r.buildPlan as BuildPlanDoc | null,
    planReview: r.planReview as ReviewResult | null,
    verificationOut: r.verificationOut as FeatureBuildRow["verificationOut"],
    acceptanceMet: r.acceptanceMet as FeatureBuildRow["acceptanceMet"],
    uxVerificationStatus: r.uxVerificationStatus as FeatureBuildRow["uxVerificationStatus"],
    uxTestResults: r.uxTestResults as FeatureBuildRow["uxTestResults"],
    plan: r.plan as Record<string, unknown> | null,
    portfolioId: r.portfolioId,
    contributionMode,
    phaseHandoffs: r.phaseHandoffs,
    taxonomyContext,
    designSystem,
    businessContext,
    scoutFindings,
    intentConfirmation,
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
