// apps/web/lib/build/feature-attribution.ts
//
// Taxonomy attribution for Build Studio features.
// Reuses the token-scoring pipeline from discovery-attribution,
// adapted for feature briefs instead of infrastructure entities.

import { prisma, type Prisma } from "@dpf/db";
import {
  scoreTaxonomyCandidates,
  flattenEnrichmentForScoring,
  type TaxonomyNodeCandidate,
} from "@dpf/db/discovery-attribution";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaxonomyAttribution = {
  method: "rule" | "heuristic" | "ai_proposed" | "manual" | "invalid_portfolio";
  confidence: number;
  portfolioSlug?: string | null;
  invalidPortfolioContext?: string | null;
  validPortfolioOptions?: Array<{ slug: string; name: string }>;
  confirmedNodeId: string | null;
  topCandidate: {
    nodeId: string;
    nodeName: string;
    score: number;
    evidence: string;
  } | null;
  candidates: Array<{
    nodeId: string;
    nodeName: string;
    score: number;
    evidence: string;
  }>;
  proposedNewNode: {
    parentNodeId: string;
    name: string;
    description: string;
    rationale: string;
    proposalId?: string | null;
  } | null;
  attributedAt: string;
};

type FeatureBriefInput = {
  title: string;
  description: string;
  portfolioContext?: string;
  acceptanceCriteria?: string[];
  targetRoles?: string[];
  dataNeeds?: string;
};

type TaxonomyNodeReference = {
  id: string;
  nodeId: string;
  name: string;
  parentId: string | null;
};

type TaxonomyNodeResolution =
  | { status: "found"; node: TaxonomyNodeReference }
  | { status: "not_found"; message: string }
  | { status: "ambiguous"; message: string };

const TAXONOMY_NODE_REFERENCE_SELECT = {
  id: true,
  nodeId: true,
  name: true,
  parentId: true,
} as const;

function defaultAttribution(): TaxonomyAttribution {
  return {
    method: "manual",
    confidence: 1.0,
    confirmedNodeId: null,
    topCandidate: null,
    candidates: [],
    proposedNewNode: null,
    attributedAt: new Date().toISOString(),
  };
}

function normalizeExistingAttribution(raw: unknown): TaxonomyAttribution {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...defaultAttribution(), ...(raw as Partial<TaxonomyAttribution>) }
    : defaultAttribution();
}

function attributionJson(attribution: TaxonomyAttribution): Prisma.InputJsonValue {
  return attribution as unknown as Prisma.InputJsonValue;
}

async function resolveTaxonomyNodeReference(reference: string): Promise<TaxonomyNodeResolution> {
  const trimmed = reference.trim();
  if (!trimmed) {
    return { status: "not_found", message: "Taxonomy node reference is empty" };
  }

  const exactNodeId = await prisma.taxonomyNode.findUnique({
    where: { nodeId: trimmed },
    select: TAXONOMY_NODE_REFERENCE_SELECT,
  });
  if (exactNodeId) return { status: "found", node: exactNodeId };

  const exactRowId = await prisma.taxonomyNode.findUnique({
    where: { id: trimmed },
    select: TAXONOMY_NODE_REFERENCE_SELECT,
  });
  if (exactRowId) return { status: "found", node: exactRowId };

  const suffixMatches = await prisma.taxonomyNode.findMany({
    where: {
      status: "active",
      nodeId: { endsWith: `/${trimmed}` },
    },
    select: TAXONOMY_NODE_REFERENCE_SELECT,
    orderBy: { nodeId: "asc" },
    take: 5,
  });

  if (suffixMatches.length === 1) {
    return { status: "found", node: suffixMatches[0]! };
  }

  if (suffixMatches.length > 1) {
    return {
      status: "ambiguous",
      message: `Taxonomy node reference ${trimmed} is ambiguous. Use the full nodeId: ${suffixMatches.map((n) => n.nodeId).join(", ")}`,
    };
  }

  return { status: "not_found", message: `Taxonomy node ${trimmed} not found` };
}

// ─── Attribution Pipeline ───────────────────────────────────────────────────

/**
 * Build a text descriptor from a feature brief for token-based scoring.
 */
function buildFeatureDescriptor(brief: FeatureBriefInput): string {
  const parts = [
    brief.title,
    brief.description,
    ...(brief.acceptanceCriteria ?? []),
    ...(brief.targetRoles ?? []),
    brief.dataNeeds ?? "",
  ];
  return parts.filter(Boolean).join(" ");
}

/**
 * Run the taxonomy attribution pipeline for a feature build.
 * Searches within the selected portfolio's taxonomy subtree first.
 *
 * Returns a TaxonomyAttribution object to be stored on FeatureBuild.taxonomyAttribution.
 */
export async function attributeFeatureBuild(
  buildId: string,
  brief: FeatureBriefInput,
): Promise<TaxonomyAttribution> {
  // 1. If the build already has a product, inherit its taxonomy node (deterministic)
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      digitalProductId: true,
      digitalProduct: { select: { taxonomyNodeId: true, taxonomyNode: { select: { nodeId: true, name: true } } } },
    },
  });

  if (build?.digitalProduct?.taxonomyNodeId && build.digitalProduct.taxonomyNode) {
    return {
      method: "rule",
      confidence: 0.98,
      portfolioSlug: null,
      confirmedNodeId: build.digitalProduct.taxonomyNode.nodeId,
      topCandidate: {
        nodeId: build.digitalProduct.taxonomyNode.nodeId,
        nodeName: build.digitalProduct.taxonomyNode.name,
        score: 0.98,
        evidence: "Inherited from existing product attribution",
      },
      candidates: [],
      proposedNewNode: null,
      attributedAt: new Date().toISOString(),
    };
  }

  // 2. Load taxonomy nodes, scoped to portfolio if provided.
  const portfolioContext = brief.portfolioContext?.trim() ?? "";
  let portfolioId: string | null = null;
  let portfolioSlug: string | null = null;
  if (portfolioContext) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: portfolioContext },
      select: { id: true, slug: true, name: true },
    });
    if (!portfolio) {
      const options = await prisma.portfolio.findMany({
        select: { slug: true, name: true },
        orderBy: { name: "asc" },
        take: 8,
      });
      return {
        method: "invalid_portfolio",
        confidence: 0,
        portfolioSlug: null,
        invalidPortfolioContext: portfolioContext,
        validPortfolioOptions: options,
        confirmedNodeId: null,
        topCandidate: null,
        candidates: [],
        proposedNewNode: null,
        attributedAt: new Date().toISOString(),
      };
    }
    portfolioId = portfolio?.id ?? null;
    portfolioSlug = portfolio?.slug ?? null;
  }

  const nodes = await prisma.taxonomyNode.findMany({
    where: {
      status: "active",
      ...(portfolioId ? { portfolioId } : {}),
    },
    select: { id: true, nodeId: true, name: true, portfolioId: true, description: true, enrichment: true },
  });

  // Convert to TaxonomyNodeCandidate format with description and enrichment for richer matching
  const candidates: TaxonomyNodeCandidate[] = nodes.map((n) => ({
    nodeId: n.nodeId,
    name: n.description ? `${n.name} ${n.description}` : n.name,
    portfolioSlug: null,
    description: n.description,
    enrichmentText: flattenEnrichmentForScoring(n.enrichment as Record<string, unknown> | null),
  }));

  // 3. Score candidates using the shared heuristic pipeline
  const descriptor = buildFeatureDescriptor(brief);
  const ranked = scoreTaxonomyCandidates(descriptor, candidates);

  // Map back to display names (without description concatenation)
  const nodeNameMap = new Map(nodes.map((n) => [n.nodeId, n.name]));
  const mappedCandidates = ranked.map((r) => ({
    nodeId: r.nodeId,
    nodeName: nodeNameMap.get(r.nodeId) ?? r.nodeId,
    score: r.score,
    evidence: r.evidence.join(", "),
  }));

  const best = mappedCandidates[0] ?? null;
  const confidence = best?.score ?? 0;

  return {
    method: "heuristic",
    confidence,
    portfolioSlug,
    confirmedNodeId: null,  // not confirmed until user approves
    topCandidate: best,
    candidates: mappedCandidates.slice(0, 5),
    proposedNewNode: null,
    attributedAt: new Date().toISOString(),
  };
}

/**
 * Confirm a taxonomy placement for a feature build.
 * Updates the FeatureBuild.taxonomyAttribution with the confirmed node.
 */
export async function confirmFeatureTaxonomy(
  buildId: string,
  nodeId: string | null,
  proposeNew?: { parentNodeId: string; name: string; description: string; rationale: string },
): Promise<{ success: boolean; message: string; confirmedNodeId?: string; proposalId?: string }> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { id: true, taxonomyAttribution: true },
  });
  if (!build) return { success: false, message: `Build ${buildId} not found` };

  // Safely parse existing attribution — guard against corrupted JSON
  let existing: TaxonomyAttribution;
  try {
    existing = normalizeExistingAttribution(build.taxonomyAttribution);
  } catch {
    existing = defaultAttribution();
  }

  if (proposeNew && !nodeId) {
    const proposedName = proposeNew.name.trim();
    const description = proposeNew.description.trim();
    const rationale = proposeNew.rationale.trim();
    if (!proposedName) {
      return { success: false, message: "Proposed taxonomy node name is required" };
    }

    const parentResolution = await resolveTaxonomyNodeReference(proposeNew.parentNodeId);
    if (parentResolution.status !== "found") {
      return { success: false, message: parentResolution.message };
    }
    const parentNode = parentResolution.node;

    const proposal = await prisma.taxonomyProposal.create({
      data: {
        parentNodeId: parentNode.id,
        featureBuildId: build.id,
        proposedName,
        description: description || null,
        rationale,
        status: "proposed",
      },
      select: { id: true },
    });

    // Proposing a new taxonomy node
    const nextAttribution: TaxonomyAttribution = {
      ...existing,
      method: "ai_proposed",
      confirmedNodeId: parentNode.nodeId,  // place under parent for now
      proposedNewNode: {
        parentNodeId: parentNode.nodeId,
        name: proposedName,
        description,
        rationale,
        proposalId: proposal.id,
      },
      attributedAt: new Date().toISOString(),
    };
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        taxonomyAttribution: attributionJson(nextAttribution),
      },
    });
    return {
      success: true,
      confirmedNodeId: parentNode.nodeId,
      proposalId: proposal.id,
      message: `Proposed new taxonomy node "${proposedName}" under ${parentNode.name} (${parentNode.nodeId}). Proposal ${proposal.id} is queued for architecture review.`,
    };
  }

  if (nodeId) {
    // Confirming an existing node
    const nodeResolution = await resolveTaxonomyNodeReference(nodeId);
    if (nodeResolution.status !== "found") {
      return { success: false, message: nodeResolution.message };
    }
    const node = nodeResolution.node;

    const nextAttribution: TaxonomyAttribution = {
      ...existing,
      confirmedNodeId: node.nodeId,
      method: existing.method === "rule" ? "rule" : "manual",
      confidence: 1.0,
      topCandidate: {
        nodeId: node.nodeId,
        nodeName: node.name,
        score: 1,
        evidence: "Manually confirmed taxonomy placement",
      },
      attributedAt: new Date().toISOString(),
    };
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        taxonomyAttribution: attributionJson(nextAttribution),
      },
    });
    return {
      success: true,
      confirmedNodeId: node.nodeId,
      message: `Taxonomy placement confirmed: ${node.name} (${node.nodeId})`,
    };
  }

  return { success: false, message: "Either nodeId or proposeNew must be provided" };
}

/**
 * Generate a conversational recommendation string for the AI Coworker.
 */
export function formatAttributionRecommendation(attribution: TaxonomyAttribution): string {
  const { confidence, topCandidate, candidates } = attribution;

  if (attribution.method === "invalid_portfolio" && attribution.invalidPortfolioContext) {
    const options = attribution.validPortfolioOptions?.length
      ? ` Valid portfolio contexts: ${attribution.validPortfolioOptions.map((p) => `${p.slug} (${p.name})`).join(", ")}.`
      : "";
    return `${attribution.invalidPortfolioContext} is not a valid portfolio context, so I did not search the full taxonomy.${options} Update the feature brief portfolio and run placement again.`;
  }

  if (attribution.method === "rule" && topCandidate) {
    return `This feature belongs under **${topCandidate.nodeName}** (inherited from the existing product). No action needed.`;
  }

  if (confidence >= 0.75 && topCandidate) {
    return `Based on your description, this feature fits under **${topCandidate.nodeName}** (${Math.round(confidence * 100)}% match). Sound right?`;
  }

  if (confidence >= 0.55 && candidates.length >= 2) {
    const options = candidates.slice(0, 3).map((c, i) =>
      `${i + 1}. **${c.nodeName}** (${Math.round(c.score * 100)}% match)`
    ).join("\n");
    return `I have a few suggestions for where this fits:\n${options}\nWhich feels right, or is it something else?`;
  }

  if (candidates.length > 0) {
    const nearest = candidates[0];
    return `I couldn't find a strong match in the current taxonomy. The closest is **${nearest.nodeName}** (${Math.round(nearest.score * 100)}% match). Would you like to:\n1. Place it there for now\n2. Suggest a new category (I'll propose it to the architecture team)`;
  }

  return "I couldn't find a match in the taxonomy for this feature. Would you like to suggest a new category?";
}
