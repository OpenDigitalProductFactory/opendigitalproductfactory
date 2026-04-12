// apps/web/lib/integrate/feature-attribution.ts
//
// Taxonomy attribution for Build Studio features.
// Reuses the token-scoring pipeline from discovery-attribution,
// adapted for feature briefs instead of infrastructure entities.

import { prisma } from "@dpf/db";
import {
  scoreTaxonomyCandidates,
  flattenEnrichmentForScoring,
  type TaxonomyNodeCandidate,
  type RankedTaxonomyCandidate,
} from "@dpf/db/discovery-attribution";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaxonomyAttribution = {
  method: "rule" | "heuristic" | "ai_proposed" | "manual";
  confidence: number;
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

  // 2. Load taxonomy nodes, scoped to portfolio if provided
  let portfolioId: string | null = null;
  if (brief.portfolioContext) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: brief.portfolioContext },
      select: { id: true },
    });
    portfolioId = portfolio?.id ?? null;
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
): Promise<{ success: boolean; message: string }> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { id: true, taxonomyAttribution: true },
  });
  if (!build) return { success: false, message: `Build ${buildId} not found` };

  // Safely parse existing attribution — guard against corrupted JSON
  let existing: TaxonomyAttribution;
  try {
    const raw = build.taxonomyAttribution;
    existing = (raw && typeof raw === "object" ? raw : null) as TaxonomyAttribution | null ?? {
      method: "manual" as const,
      confidence: 1.0,
      confirmedNodeId: null,
      topCandidate: null,
      candidates: [],
      proposedNewNode: null,
      attributedAt: new Date().toISOString(),
    };
  } catch {
    existing = {
      method: "manual" as const,
      confidence: 1.0,
      confirmedNodeId: null,
      topCandidate: null,
      candidates: [],
      proposedNewNode: null,
      attributedAt: new Date().toISOString(),
    };
  }

  if (proposeNew && !nodeId) {
    // Validate that parentNodeId exists
    const parentNode = await prisma.taxonomyNode.findUnique({
      where: { nodeId: proposeNew.parentNodeId },
      select: { nodeId: true, name: true },
    });
    if (!parentNode) return { success: false, message: `Parent taxonomy node ${proposeNew.parentNodeId} not found` };

    // Proposing a new taxonomy node
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        taxonomyAttribution: {
          ...existing,
          method: "ai_proposed",
          confirmedNodeId: proposeNew.parentNodeId,  // place under parent for now
          proposedNewNode: proposeNew,
          attributedAt: new Date().toISOString(),
        },
      },
    });
    return {
      success: true,
      message: `Proposed new taxonomy node "${proposeNew.name}" under ${parentNode.name} (${proposeNew.parentNodeId}). The architecture team will review this proposal.`,
    };
  }

  if (nodeId) {
    // Confirming an existing node
    const node = await prisma.taxonomyNode.findUnique({
      where: { nodeId },
      select: { nodeId: true, name: true },
    });
    if (!node) return { success: false, message: `Taxonomy node ${nodeId} not found` };

    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        taxonomyAttribution: {
          ...existing,
          confirmedNodeId: nodeId,
          method: existing.method === "rule" ? "rule" : "manual",
          confidence: 1.0,
          attributedAt: new Date().toISOString(),
        },
      },
    });
    return { success: true, message: `Taxonomy placement confirmed: ${node.name} (${nodeId})` };
  }

  return { success: false, message: "Either nodeId or proposeNew must be provided" };
}

/**
 * Generate a conversational recommendation string for the AI Coworker.
 */
export function formatAttributionRecommendation(attribution: TaxonomyAttribution): string {
  const { confidence, topCandidate, candidates } = attribution;

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
