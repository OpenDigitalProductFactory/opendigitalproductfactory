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
import {
  buildDeviceFingerprintObservation,
  DISCOVERY_TRIAGE_AGENT_ID,
  INVENTORY_ENTITY_CANONICAL_WHERE,
  investigateUnidentifiedDevice,
  prisma,
  recordInvestigationOutcome,
  upsertFingerprintObservation,
} from "@dpf/db";
import { randomUUID } from "crypto";
import {
  applyDiscoveryTriageAutonomousReview,
  attachBoundedReview,
  DISCOVERY_TRIAGE_REVIEW_BATCH_LIMIT,
  requiresHumanReviewForOutcome,
  reviewDiscoveryTriageWithTak,
  type AutoPauseTrigger,
  type DiscoveryTriageDecisionOutcome,
  type DiscoveryTriageReviewClassification,
  type DiscoveryTriageReviewContext,
  type DiscoveryTriageReviewer,
  type ReviewFailureReason,
  type ReviewSkipReason,
} from "@/lib/discovery-triage-review";

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
  taxonomyNode: {
    findMany(args: Record<string, unknown>): Promise<Array<{ id: string; nodeId: string }>>;
    findUnique(args: { where: { nodeId: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  discoveryTriageDecision: {
    findFirst(args: Record<string, unknown>): Promise<{ decisionId: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  discoveryFingerprintObservation: {
    upsert(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  discoveryFingerprintReview: {
    create(args: unknown): Promise<unknown>;
  };
  discoveryFingerprintRule: {
    upsert(args: unknown): Promise<unknown>;
  };
  platformConfig?: {
    findUnique(args: {
      where: { key: string };
      select?: { value?: boolean };
    }): Promise<{ value: unknown } | null>;
  };
  taskRun?: {
    findMany(args: Record<string, unknown>): Promise<Array<{ progressPayload: unknown }>>;
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
  reviewed: number;
  reviewFailed: number;
  reviewFailureReason?: ReviewFailureReason;
  reviewSkipReason?: ReviewSkipReason;
  autoPauseTrigger?: AutoPauseTrigger | null;
  reviewBatchSize: number;
  reviewBatchUtilization: number;
  reviewParseSuccessRate: number;
  reviewSchemaDropCount: number;
  reviewLatencyMs: number | null;
  reviewClassificationHistogram: Partial<Record<DiscoveryTriageReviewClassification, number>>;
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
    outcome: DiscoveryTriageDecisionOutcome;
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
    reviewed: 0,
    reviewFailed: 0,
    reviewBatchSize: 0,
    reviewBatchUtilization: 0,
    reviewParseSuccessRate: 0,
    reviewSchemaDropCount: 0,
    reviewLatencyMs: null,
    reviewClassificationHistogram: {},
  };
}

function finalizeMetrics(metrics: DiscoveryTriageRunMetrics): DiscoveryTriageRunMetrics {
  return {
    ...metrics,
    escalationQueueDepth: metrics.humanReview + metrics.taxonomyGap,
    reviewBatchUtilization: Number((metrics.reviewBatchSize / DISCOVERY_TRIAGE_REVIEW_BATCH_LIMIT).toFixed(3)),
    autoApplyRate: metrics.processed > 0
      ? Number((metrics.autoAttributed / metrics.processed).toFixed(3))
      : 0,
  };
}

async function loadTaxonomyNodeLookup(
  db: DiscoveryTriageRunnerDb,
  entities: DiscoveryTriageRunnerEntity[],
): Promise<Map<string, string>> {
  const candidateIds = new Set<string>();
  for (const entity of entities) {
    for (const candidate of normalizeCandidateTaxonomy(entity.candidateTaxonomy)) {
      if (candidate.nodeId.trim()) candidateIds.add(candidate.nodeId);
    }
  }

  if (candidateIds.size === 0) return new Map();

  const candidates = [...candidateIds];
  const nodes = await db.taxonomyNode.findMany({
    where: {
      ...INVENTORY_ENTITY_CANONICAL_WHERE,
      OR: [
        { id: { in: candidates } },
        { nodeId: { in: candidates } },
      ],
    },
    select: { id: true, nodeId: true },
  });

  const lookup = new Map<string, string>();
  for (const node of nodes) {
    lookup.set(node.id, node.id);
    lookup.set(node.nodeId, node.id);
  }
  return lookup;
}

type DiscoveryTriageCandidateContext = DiscoveryTriageReviewContext & {
  entity: DiscoveryTriageRunnerEntity;
  autoApply: boolean;
  selectedTaxonomyNodeId: string | null;
  selectedIdentity: Record<string, unknown> | null;
  proposedRule: ReturnType<typeof synthesizeDiscoveryFingerprintRule>;
  qualityIssueId: string | null;
};

function buildInvestigationAttributes(entity: DiscoveryTriageRunnerEntity): Record<string, unknown> {
  const attributes = { ...(entity.properties ?? {}) };
  if (!("vendor" in attributes) && entity.manufacturer) {
    attributes.vendor = entity.manufacturer;
  }
  if (!("manufacturer" in attributes) && entity.manufacturer) {
    attributes.manufacturer = entity.manufacturer;
  }
  if (!("productModel" in attributes) && entity.productModel) {
    attributes.productModel = entity.productModel;
  }
  return attributes;
}

function observationIdFromRow(row: unknown): string | null {
  const id = row && typeof row === "object" && "id" in row
    ? (row as { id?: unknown }).id
    : null;
  return typeof id === "string"
    ? id
    : null;
}

async function investigateNeedsMoreEvidenceGap(
  db: DiscoveryTriageRunnerDb,
  context: DiscoveryTriageCandidateContext,
  actorId: string | null,
): Promise<void> {
  if (context.outcome !== "needs-more-evidence") {
    return;
  }

  const observation = buildDeviceFingerprintObservation({
    name: context.entity.name,
    attributes: buildInvestigationAttributes(context.entity),
  });
  if (!observation) {
    return;
  }

  const observationRow = await upsertFingerprintObservation(db, {
    observationKey: `triage:${context.entity.id}:fingerprint`,
    sourceKind: "discovery-triage",
    signalClass: "device_identity_gap",
    protocol: null,
    inventoryEntityId: context.entity.id,
    rawEvidenceLocal: null,
    normalizedEvidence: observation.normalizedEvidence,
    redactionStatus: "not_required",
    evidenceFamilies: observation.evidenceFamilies,
    identityCandidates: context.packet.identityCandidates,
    taxonomyCandidates: context.packet.candidateTaxonomy,
    identityConfidence: context.score.identityConfidence,
    taxonomyConfidence: context.score.taxonomyConfidence,
    candidateMargin: context.score.taxonomyAmbiguityMargin,
    blastRadiusTier: "medium",
    decisionStatus: "pending_coworker_review",
    reviewReason: "Discovery triage needs more evidence; coworker investigation queued.",
  });
  const observationId = observationIdFromRow(observationRow);
  if (!observationId) {
    return;
  }

  const result = await investigateUnidentifiedDevice(observation);
  const summary = await recordInvestigationOutcome(db, {
    observationId,
    reviewerId: actorId,
    result,
  });

  await db.discoveryFingerprintObservation.update({
    where: { id: observationId },
    data: {
      decisionStatus: summary.nextStatus,
      reviewReason: result.rationale,
    },
  });
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
    enableAutonomousReview?: boolean;
    autonomousReviewer?: DiscoveryTriageReviewer;
  } = {},
): Promise<DiscoveryTriageRunResult> {
  const trigger = options.trigger ?? "cadence";
  const actorType = options.actorType ?? "agent";
  const actorId = options.actorId ?? DEFAULT_DISCOVERY_TRIAGE_ACTOR_ID;
  const thresholds = options.thresholds ?? DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS;
  const processedAt = (options.now ?? new Date()).toISOString();

  const issues = await db.portfolioQualityIssue.findMany({
    where: {
      status: "open",
      inventoryEntityId: { not: null },
    },
    orderBy: [{ lastDetectedAt: "desc" }],
  });
  const issueEntityIds = Array.from(new Set(
    issues
      .map((issue) => issue.inventoryEntityId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  ));
  const entities = await db.inventoryEntity.findMany({
    where: {
      OR: [
        { attributionStatus: "needs_review" },
        { attributionConfidence: { lt: thresholds.coworkerAutoApply } },
        ...(issueEntityIds.length > 0 ? [{ id: { in: issueEntityIds } }] : []),
      ],
    },
    orderBy: [{ lastSeenAt: "desc" }],
  });

  const taxonomyNodeIdByCandidate = await loadTaxonomyNodeLookup(db, entities);
  const issueByEntityId = new Map(
    issues
      .filter((issue) => issue.inventoryEntityId)
      .map((issue) => [issue.inventoryEntityId as string, issue]),
  );

  const metrics = createEmptyMetrics();
  const decisions: DiscoveryTriageRunResult["decisions"] = [];
  const seen = new Set<string>();
  const contexts: DiscoveryTriageCandidateContext[] = [];

  for (const entity of entities) {
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);

    const packet = buildDiscoveryEvidencePacket(buildPacketInput(entity));
    const packetWithRunMetadata = attachRunMetadata(packet, {
      runIdempotencyKey: options.runIdempotencyKey,
      trigger,
    });
    const score = scoreDiscoveryTriageCandidate(packetWithRunMetadata, thresholds);
    const proceduralOutcome = resolveDiscoveryTriageOutcome(
      score,
      packetWithRunMetadata,
      thresholds,
    ) as DiscoveryTriageDecisionOutcome;
    const autoApply = shouldAutoApplyTriageDecision(score, packetWithRunMetadata, thresholds);
    const selectedTaxonomyCandidateId = packetWithRunMetadata.candidateTaxonomy[0]?.nodeId ?? null;
    const selectedTaxonomyNodeId = selectedTaxonomyCandidateId
      ? taxonomyNodeIdByCandidate.get(selectedTaxonomyCandidateId) ?? null
      : null;
    const selectedIdentity = packetWithRunMetadata.identityCandidates[0]
      ? {
          label: packetWithRunMetadata.identityCandidates[0].identity,
          manufacturer: packetWithRunMetadata.identityCandidates[0].manufacturer ?? null,
          model: packetWithRunMetadata.identityCandidates[0].model ?? null,
          version: packetWithRunMetadata.identityCandidates[0].version ?? null,
        }
      : null;
    const proposedRule = proceduralOutcome === "auto-attributed"
      ? withResolvedProposedRuleTaxonomyNodeId(
        synthesizeDiscoveryFingerprintRule(packetWithRunMetadata, score, thresholds),
        selectedTaxonomyNodeId,
      )
      : null;

    contexts.push({
      entity,
      packet: packetWithRunMetadata,
      score,
      proceduralOutcome,
      outcome: proceduralOutcome,
      requiresHumanReview: requiresHumanReviewForOutcome(proceduralOutcome),
      autoApply,
      selectedTaxonomyNodeId,
      selectedIdentity,
      proposedRule,
      boundedReview: null,
      qualityIssueId: issueByEntityId.get(entity.id)?.id ?? null,
    });
  }

  const reviewer = options.autonomousReviewer ?? (options.enableAutonomousReview ? reviewDiscoveryTriageWithTak : null);
  if (reviewer) {
    await applyDiscoveryTriageAutonomousReview(db, {
      actorId,
      reviewer,
      contexts,
      metrics,
    });
  }

  for (const context of contexts) {
    if (context.autoApply && context.selectedTaxonomyNodeId && context.outcome === "auto-attributed") {
      await db.inventoryEntity.update({
        where: { id: context.entity.id },
        data: {
          taxonomyNodeId: context.selectedTaxonomyNodeId,
          attributionStatus: "attributed",
          attributionMethod: "ai-proposed",
          attributionConfidence: context.score.taxonomyConfidence,
          attributionEvidence: context.packet,
        },
      });
    }

    await recordDiscoveryTriageDecision(db, {
      decisionId: `triage-${context.entity.id}-${randomUUID().slice(0, 8)}`,
      inventoryEntityId: context.entity.id,
      qualityIssueId: context.qualityIssueId,
      actorType,
      actorId,
      outcome: context.outcome,
      score: context.score,
      evidencePacket: attachBoundedReview(context.packet, context.boundedReview),
      proposedRule: context.outcome === "auto-attributed" ? context.proposedRule : null,
      selectedTaxonomyNodeId: context.selectedTaxonomyNodeId,
      selectedIdentity: context.selectedIdentity,
      requiresHumanReview: context.requiresHumanReview,
    });

    try {
      await investigateNeedsMoreEvidenceGap(db, context, actorId);
    } catch {
      // Triage must remain durable even when the layer-1 investigation side
      // path cannot persist its review artifact in this pass.
    }

    metrics.processed += 1;
    metrics.decisionsCreated += 1;
    if (context.outcome === "auto-attributed") metrics.autoAttributed += 1;
    if (context.outcome === "human-review") metrics.humanReview += 1;
    if (context.outcome === "taxonomy-gap") metrics.taxonomyGap += 1;
    if (context.outcome === "needs-more-evidence") metrics.needsMoreEvidence += 1;
    if (context.outcome === "dismissed") metrics.dismissed += 1;
    if (issueByEntityId.has(context.entity.id) || context.entity.attributionStatus === "needs_review") {
      metrics.repeatUnresolved += 1;
    }

    decisions.push({
      inventoryEntityId: context.entity.id,
      outcome: context.outcome,
      requiresHumanReview: context.requiresHumanReview,
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
    enableAutonomousReview?: boolean;
    autonomousReviewer?: DiscoveryTriageReviewer;
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
    enableAutonomousReview: options.enableAutonomousReview,
    autonomousReviewer: options.autonomousReviewer,
  });
}

function withResolvedProposedRuleTaxonomyNodeId<T extends { taxonomyNodeId: string } | null>(
  proposedRule: T,
  selectedTaxonomyNodeId: string | null,
): T {
  if (!proposedRule || !selectedTaxonomyNodeId) return proposedRule;
  return {
    ...proposedRule,
    taxonomyNodeId: selectedTaxonomyNodeId,
  };
}

export async function maybeTriggerDiscoveryTriageForVolume(
  db: DiscoveryTriageRunnerDb = prisma as unknown as DiscoveryTriageRunnerDb,
  options: {
    actorId?: string | null;
    actorType?: "agent" | "human" | "system";
    now?: Date;
    threshold?: number;
    thresholds?: DiscoveryTriageThresholds;
    enableAutonomousReview?: boolean;
    autonomousReviewer?: DiscoveryTriageReviewer;
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
      ...INVENTORY_ENTITY_CANONICAL_WHERE,
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
    enableAutonomousReview: options.enableAutonomousReview,
    autonomousReviewer: options.autonomousReviewer,
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
