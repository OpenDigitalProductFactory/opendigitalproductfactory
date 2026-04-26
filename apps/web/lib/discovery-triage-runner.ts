import {
  buildDiscoveryEvidencePacket,
  DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
  type DiscoveryEvidencePacket,
  recordDiscoveryTriageDecision,
  resolveDiscoveryTriageOutcome,
  scoreDiscoveryTriageCandidate,
  shouldAutoApplyTriageDecision,
  synthesizeDiscoveryFingerprintRule,
  type DiscoveryEvidencePacketInput,
  type DiscoveryTriageThresholds,
} from "@dpf/db/discovery-triage";
import { DISCOVERY_TRIAGE_AGENT_ID, prisma } from "@dpf/db";
import { randomUUID } from "crypto";

export type DiscoveryTriageTrigger = "cadence" | "volume";
export const DEFAULT_DISCOVERY_TRIAGE_ACTOR_ID = DISCOVERY_TRIAGE_AGENT_ID;
export const DEFAULT_DISCOVERY_TRIAGE_VOLUME_THRESHOLD = 25;

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
    count(args: Record<string, unknown>): Promise<number>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  portfolioQualityIssue: {
    findMany(args: Record<string, unknown>): Promise<DiscoveryTriageRunnerIssue[]>;
  };
  discoveryTriageDecision: {
    findFirst(args: Record<string, unknown>): Promise<{ decisionId: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type DiscoveryTriageRunMetrics = {
  processed: number;
  decisionsCreated: number;
  autoAttributed: number;
  humanReview: number;
  taxonomyGap: number;
  needsMoreEvidence: number;
  dismissed: number;
  escalationQueueDepth: number;
  repeatUnresolved: number;
  autoApplyRate: number;
};

export type DiscoveryTriageRunResult = {
  trigger: DiscoveryTriageTrigger;
  processedAt: string;
  runIdempotencyKey?: string;
  skipped?: boolean;
  skipReason?: string | null;
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

function formatRunDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function buildRunIdempotencyKey(
  now: Date,
  actorId: string,
  trigger: DiscoveryTriageTrigger,
): string {
  return `${formatRunDay(now)}:${actorId}:${trigger}`;
}

function buildDayRange(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function attachRunMetadata(
  packet: DiscoveryEvidencePacket,
  input: {
    runIdempotencyKey?: string;
    trigger?: DiscoveryTriageTrigger;
  },
): DiscoveryEvidencePacket {
  if (!input.runIdempotencyKey && !input.trigger) {
    return packet;
  }

  return {
    ...packet,
    runIdempotencyKey: input.runIdempotencyKey ?? null,
    triggerFamily: input.trigger ?? null,
  };
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
    decisionsCreated: 0,
    autoAttributed: 0,
    humanReview: 0,
    taxonomyGap: 0,
    needsMoreEvidence: 0,
    dismissed: 0,
    escalationQueueDepth: 0,
    repeatUnresolved: 0,
    autoApplyRate: 0,
  };
}

function finalizeMetrics(metrics: DiscoveryTriageRunMetrics): DiscoveryTriageRunMetrics {
  return {
    ...metrics,
    escalationQueueDepth: metrics.humanReview + metrics.taxonomyGap,
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
    now?: Date;
    runIdempotencyKey?: string;
    thresholds?: DiscoveryTriageThresholds;
  } = {},
): Promise<DiscoveryTriageRunResult> {
  const trigger = options.trigger ?? "cadence";
  const actorType = options.actorType ?? "agent";
  const actorId = options.actorId ?? DEFAULT_DISCOVERY_TRIAGE_ACTOR_ID;
  const thresholds = options.thresholds ?? DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS;
  const processedAt = (options.now ?? new Date()).toISOString();

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
    const packetWithRunMetadata = attachRunMetadata(packet, {
      runIdempotencyKey: options.runIdempotencyKey,
      trigger,
    });
    const score = scoreDiscoveryTriageCandidate(packetWithRunMetadata, thresholds);
    const outcome = resolveDiscoveryTriageOutcome(score, packetWithRunMetadata, thresholds);
    const requiresHumanReview = outcome === "human-review" || outcome === "taxonomy-gap";
    const autoApply = shouldAutoApplyTriageDecision(score, packetWithRunMetadata, thresholds);
    const selectedTaxonomyNodeId = packetWithRunMetadata.candidateTaxonomy[0]?.nodeId ?? null;
    const selectedIdentity = packetWithRunMetadata.identityCandidates[0]
      ? {
          label: packetWithRunMetadata.identityCandidates[0].identity,
          manufacturer: packetWithRunMetadata.identityCandidates[0].manufacturer ?? null,
          model: packetWithRunMetadata.identityCandidates[0].model ?? null,
          version: packetWithRunMetadata.identityCandidates[0].version ?? null,
        }
      : null;
    const proposedRule = outcome === "auto-attributed"
      ? synthesizeDiscoveryFingerprintRule(packetWithRunMetadata, score, thresholds)
      : null;

    if (autoApply && selectedTaxonomyNodeId) {
      await db.inventoryEntity.update({
        where: { id: entity.id },
        data: {
          taxonomyNodeId: selectedTaxonomyNodeId,
          attributionStatus: "attributed",
          attributionMethod: "ai-proposed",
          attributionConfidence: score.taxonomyConfidence,
          attributionEvidence: packetWithRunMetadata,
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
      evidencePacket: packetWithRunMetadata,
      proposedRule,
      selectedTaxonomyNodeId,
      selectedIdentity,
      requiresHumanReview,
    });

    metrics.processed += 1;
    metrics.decisionsCreated += 1;
    if (outcome === "auto-attributed") metrics.autoAttributed += 1;
    if (outcome === "human-review") metrics.humanReview += 1;
    if (outcome === "taxonomy-gap") metrics.taxonomyGap += 1;
    if (outcome === "needs-more-evidence") metrics.needsMoreEvidence += 1;
    if (outcome === "dismissed") metrics.dismissed += 1;
    if (issueByEntityId.has(entity.id) || entity.attributionStatus === "needs_review") {
      metrics.repeatUnresolved += 1;
    }

    decisions.push({
      inventoryEntityId: entity.id,
      outcome,
      requiresHumanReview,
    });
  }

  return {
    trigger,
    processedAt,
    runIdempotencyKey: options.runIdempotencyKey,
    metrics: finalizeMetrics(metrics),
    decisions,
  };
}

export async function runDiscoveryTriageDaily(
  db: DiscoveryTriageRunnerDb = prisma as unknown as DiscoveryTriageRunnerDb,
  options: {
    actorId?: string | null;
    actorType?: "agent" | "human" | "system";
    trigger?: DiscoveryTriageTrigger;
    now?: Date;
    thresholds?: DiscoveryTriageThresholds;
  } = {},
): Promise<DiscoveryTriageRunResult> {
  const now = options.now ?? new Date();
  const trigger = options.trigger ?? "cadence";
  const actorId = options.actorId ?? DEFAULT_DISCOVERY_TRIAGE_ACTOR_ID;
  const { start, end } = buildDayRange(now);
  const runIdempotencyKey = buildRunIdempotencyKey(now, actorId, trigger);

  const existing = await db.discoveryTriageDecision.findFirst({
    where: {
      actorId,
      createdAt: {
        gte: start,
        lt: end,
      },
      evidencePacket: {
        path: ["runIdempotencyKey"],
        equals: runIdempotencyKey,
      },
    },
    select: { decisionId: true },
  });

  if (existing) {
    return {
      trigger,
      processedAt: now.toISOString(),
      runIdempotencyKey,
      skipped: true,
      skipReason: `Duplicate ${trigger} triage run already recorded today.`,
      metrics: finalizeMetrics(createEmptyMetrics()),
      decisions: [],
    };
  }

  return runDiscoveryTriagePass(db, {
    trigger,
    actorType: options.actorType ?? "agent",
    actorId,
    now,
    runIdempotencyKey,
    thresholds: options.thresholds,
  });
}

export async function maybeTriggerDiscoveryTriageForVolume(
  db: DiscoveryTriageRunnerDb = prisma as unknown as DiscoveryTriageRunnerDb,
  options: {
    actorId?: string | null;
    actorType?: "agent" | "human" | "system";
    now?: Date;
    threshold?: number;
    thresholds?: DiscoveryTriageThresholds;
  } = {},
): Promise<{
  triggered: boolean;
  reason: string;
  pendingCount: number;
  threshold: number;
  result?: DiscoveryTriageRunResult;
}> {
  const threshold = options.threshold ?? DEFAULT_DISCOVERY_TRIAGE_VOLUME_THRESHOLD;
  const pendingCount = await db.inventoryEntity.count({
    where: {
      attributionStatus: "needs_review",
    },
  });

  if (pendingCount < threshold) {
    return {
      triggered: false,
      reason: `Needs-review queue (${pendingCount}) is below the volume threshold (${threshold}).`,
      pendingCount,
      threshold,
    };
  }

  const result = await runDiscoveryTriageDaily(db, {
    actorId: options.actorId,
    actorType: options.actorType,
    trigger: "volume",
    now: options.now,
    thresholds: options.thresholds,
  });

  return {
    triggered: !result.skipped,
    reason: result.skipped
      ? result.skipReason ?? "Volume triage was skipped because a matching run already exists."
      : `Volume threshold reached at ${pendingCount} needs-review entities.`,
    pendingCount,
    threshold,
    result,
  };
}
