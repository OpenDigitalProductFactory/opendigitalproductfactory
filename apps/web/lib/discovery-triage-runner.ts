import {
  buildDiscoveryEvidencePacket,
  DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
  recordDiscoveryTriageDecision,
  resolveDiscoveryTriageOutcome,
  scoreDiscoveryTriageCandidate,
  shouldAutoApplyTriageDecision,
  synthesizeDiscoveryFingerprintRule,
  type DiscoveryEvidencePacketInput,
  type DiscoveryTriageThresholds,
} from "@dpf/db/discovery-triage";
import { prisma } from "@dpf/db";
import { randomUUID } from "crypto";

export type DiscoveryTriageTrigger = "cadence" | "volume";

export type DiscoveryTriageRunnerEntity = {
  id: string;
  entityKey: string;
  entityType: string;
  name: string;
  itemType?: string | null;
  providerView?: string | null;
  manufacturer?: string | null;
  productModel?: string | null;
  observedVersion?: string | null;
  normalizedVersion?: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  confidence?: number | null;
  attributionStatus: string;
  attributionConfidence?: number | null;
  attributionEvidence?: Record<string, unknown> | null;
  candidateTaxonomy?: Array<{ nodeId: string; name?: string | null; score: number }> | null;
  properties?: Record<string, unknown> | null;
  taxonomyNodeId?: string | null;
};

export type DiscoveryTriageRunnerIssue = {
  id: string;
  issueType: string;
  inventoryEntityId?: string | null;
  summary: string;
};

export type DiscoveryTriageRunnerDb = {
  inventoryEntity: {
    findMany(args: Record<string, unknown>): Promise<DiscoveryTriageRunnerEntity[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  portfolioQualityIssue: {
    findMany(args: Record<string, unknown>): Promise<DiscoveryTriageRunnerIssue[]>;
  };
  discoveryTriageDecision: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type DiscoveryTriageRunMetrics = {
  processed: number;
  autoAttributed: number;
  humanReview: number;
  taxonomyGap: number;
  needsMoreEvidence: number;
  dismissed: number;
  autoApplyRate: number;
};

export type DiscoveryTriageRunResult = {
  trigger: DiscoveryTriageTrigger;
  processedAt: string;
  metrics: DiscoveryTriageRunMetrics;
  decisions: Array<{
    inventoryEntityId: string;
    outcome: "auto-attributed" | "human-review" | "taxonomy-gap" | "needs-more-evidence" | "dismissed";
    requiresHumanReview: boolean;
  }>;
};

function normalizeCandidateTaxonomy(
  value: DiscoveryTriageRunnerEntity["candidateTaxonomy"],
): Array<{ nodeId: string; name?: string | null; score: number }> {
  return Array.isArray(value) ? [...value] : [];
}

function buildPacketInput(entity: DiscoveryTriageRunnerEntity): DiscoveryEvidencePacketInput {
  return {
    id: entity.id,
    entityKey: entity.entityKey,
    entityType: entity.entityType,
    name: entity.name,
    itemType: entity.itemType ?? null,
    source: entity.providerView ?? null,
    firstSeenAt: entity.firstSeenAt,
    lastSeenAt: entity.lastSeenAt,
    confidence: entity.confidence ?? null,
    attributionConfidence: entity.attributionConfidence ?? null,
    manufacturer: entity.manufacturer ?? null,
    productModel: entity.productModel ?? null,
    observedVersion: entity.observedVersion ?? null,
    normalizedVersion: entity.normalizedVersion ?? null,
    attributionEvidence: entity.attributionEvidence ?? null,
    candidateTaxonomy: normalizeCandidateTaxonomy(entity.candidateTaxonomy),
    properties: entity.properties ?? {},
    hasSuitableTaxonomy: normalizeCandidateTaxonomy(entity.candidateTaxonomy).length > 0,
  };
}

function createEmptyMetrics(): DiscoveryTriageRunMetrics {
  return {
    processed: 0,
    autoAttributed: 0,
    humanReview: 0,
    taxonomyGap: 0,
    needsMoreEvidence: 0,
    dismissed: 0,
    autoApplyRate: 0,
  };
}

function finalizeMetrics(metrics: DiscoveryTriageRunMetrics): DiscoveryTriageRunMetrics {
  return {
    ...metrics,
    autoApplyRate: metrics.processed > 0
      ? Number((metrics.autoAttributed / metrics.processed).toFixed(3))
      : 0,
  };
}

export async function runDiscoveryTriagePass(
  db: DiscoveryTriageRunnerDb = prisma as unknown as DiscoveryTriageRunnerDb,
  options: {
    trigger?: DiscoveryTriageTrigger;
    actorType?: "agent" | "human" | "system";
    actorId?: string | null;
    thresholds?: DiscoveryTriageThresholds;
  } = {},
): Promise<DiscoveryTriageRunResult> {
  const trigger = options.trigger ?? "cadence";
  const actorType = options.actorType ?? "agent";
  const actorId = options.actorId ?? "discovery-steward";
  const thresholds = options.thresholds ?? DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS;

  const [entities, issues] = await Promise.all([
    db.inventoryEntity.findMany({
      where: {
        OR: [
          { attributionStatus: "needs_review" },
          { attributionConfidence: { lt: thresholds.coworkerAutoApply } },
        ],
      },
      orderBy: [{ lastSeenAt: "desc" }],
    }),
    db.portfolioQualityIssue.findMany({
      where: {
        status: "open",
        inventoryEntityId: { not: null },
      },
      orderBy: [{ lastDetectedAt: "desc" }],
    }),
  ]);

  const issueByEntityId = new Map(
    issues
      .filter((issue) => issue.inventoryEntityId)
      .map((issue) => [issue.inventoryEntityId as string, issue]),
  );

  const metrics = createEmptyMetrics();
  const decisions: DiscoveryTriageRunResult["decisions"] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);

    const packet = buildDiscoveryEvidencePacket(buildPacketInput(entity));
    const score = scoreDiscoveryTriageCandidate(packet, thresholds);
    const outcome = resolveDiscoveryTriageOutcome(score, packet, thresholds);
    const requiresHumanReview = outcome === "human-review" || outcome === "taxonomy-gap";
    const autoApply = shouldAutoApplyTriageDecision(score, packet, thresholds);
    const selectedTaxonomyNodeId = packet.candidateTaxonomy[0]?.nodeId ?? null;
    const selectedIdentity = packet.identityCandidates[0]
      ? {
          label: packet.identityCandidates[0].identity,
          manufacturer: packet.identityCandidates[0].manufacturer ?? null,
          model: packet.identityCandidates[0].model ?? null,
          version: packet.identityCandidates[0].version ?? null,
        }
      : null;
    const proposedRule = outcome === "auto-attributed"
      ? synthesizeDiscoveryFingerprintRule(packet, score, thresholds)
      : null;

    if (autoApply && selectedTaxonomyNodeId) {
      await db.inventoryEntity.update({
        where: { id: entity.id },
        data: {
          taxonomyNodeId: selectedTaxonomyNodeId,
          attributionStatus: "attributed",
          attributionMethod: "ai-proposed",
          attributionConfidence: score.taxonomyConfidence,
          attributionEvidence: packet,
        },
      });
    }

    await recordDiscoveryTriageDecision(db, {
      decisionId: `triage-${entity.id}-${randomUUID().slice(0, 8)}`,
      inventoryEntityId: entity.id,
      qualityIssueId: issueByEntityId.get(entity.id)?.id ?? null,
      actorType,
      actorId,
      outcome,
      score,
      evidencePacket: packet,
      proposedRule,
      selectedTaxonomyNodeId,
      selectedIdentity,
      requiresHumanReview,
    });

    metrics.processed += 1;
    if (outcome === "auto-attributed") metrics.autoAttributed += 1;
    if (outcome === "human-review") metrics.humanReview += 1;
    if (outcome === "taxonomy-gap") metrics.taxonomyGap += 1;
    if (outcome === "needs-more-evidence") metrics.needsMoreEvidence += 1;
    if (outcome === "dismissed") metrics.dismissed += 1;

    decisions.push({
      inventoryEntityId: entity.id,
      outcome,
      requiresHumanReview,
    });
  }

  return {
    trigger,
    processedAt: new Date().toISOString(),
    metrics: finalizeMetrics(metrics),
    decisions,
  };
}
