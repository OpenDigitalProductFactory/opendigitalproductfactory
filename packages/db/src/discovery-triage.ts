import { buildDiscoveryDescriptor } from "./discovery-attribution";
import type { TriageActorType, TriageOutcome } from "./discovery-triage-enums";

export type DiscoveryTriageTaxonomyCandidate = {
  nodeId: string;
  name?: string | null;
  score: number;
};

export type DiscoveryTriageIdentityCandidate = {
  identity: string;
  score: number;
  manufacturer?: string | null;
  model?: string | null;
  version?: string | null;
};

export type DiscoveryProtocolEvidence = {
  ports: number[];
  banners: string[];
  prometheusLabels: Record<string, unknown>;
  containerImage?: string | null;
  containerName?: string | null;
  processName?: string | null;
  packageName?: string | null;
  softwareEvidence: string[];
  snmpSystemFields: Record<string, unknown>;
  macVendor?: string | null;
  dhcpHints: string[];
  mdnsServices: string[];
  upnpDescriptors: string[];
  netbiosNames: string[];
};

export type DiscoveryEvidencePacketInput = {
  id: string;
  entityKey: string;
  entityType: string;
  name: string;
  itemType?: string | null;
  source?: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  confidence?: number | null;
  attributionConfidence?: number | null;
  manufacturer?: string | null;
  productModel?: string | null;
  observedVersion?: string | null;
  normalizedVersion?: string | null;
  attributionEvidence?: Record<string, unknown> | null;
  candidateTaxonomy?: DiscoveryTriageTaxonomyCandidate[] | null;
  identityCandidates?: DiscoveryTriageIdentityCandidate[] | null;
  properties?: Record<string, unknown> | null;
  discoveryRunIds?: string[] | null;
  collectorNames?: string[] | null;
  hasSuitableTaxonomy?: boolean;
  policyRisk?: boolean;
  customerSensitive?: boolean;
};

export type DiscoveryEvidencePacket = {
  inventoryEntity: {
    id: string;
    entityKey: string;
    entityType: string;
    name: string;
    itemType?: string | null;
    source?: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  discoveryRunIds: string[];
  collectorNames: string[];
  observedAttributes: Record<string, unknown>;
  normalizedDescriptor: string;
  candidateTaxonomy: DiscoveryTriageTaxonomyCandidate[];
  identityCandidates: DiscoveryTriageIdentityCandidate[];
  matchedRuleIds: string[];
  protocolEvidence: DiscoveryProtocolEvidence;
  evidenceFreshness: {
    observedSpanHours: number;
  };
  reproducibility: {
    runCount: number;
    observedSpanHours: number;
    consistentSignature: boolean;
  };
  redactionStatus: "unverified";
  policyRisk: boolean;
  customerSensitive: boolean;
  hasSuitableTaxonomy: boolean;
  independentSignalCount: number;
  runIdempotencyKey?: string | null;
  triggerFamily?: "cadence" | "volume" | null;
};

export type DiscoveryTriageThresholds = {
  deterministicAutoApply: number;
  coworkerAutoApply: number;
  taxonomyGapIdentity: number;
  humanReviewFloor: number;
  ambiguityMargin: number;
};

export type DiscoveryTriageScore = {
  identityConfidence: number;
  taxonomyConfidence: number;
  evidenceCompleteness: number;
  reproducibilityScore: number;
  identityAmbiguityMargin: number;
  taxonomyAmbiguityMargin: number;
};

export type DiscoveryTriageProposedRule = {
  ruleType: "discovery-fingerprint";
  requiredSignals: Array<{ signal: string; value: unknown }>;
  taxonomyNodeId: string;
  identity: {
    label: string;
    manufacturer?: string | null;
    model?: string | null;
    version?: string | null;
  };
  confidenceFloor: number;
  redactionStatus: "unverified";
};

export type DiscoveryTriageDecisionInput = {
  decisionId: string;
  inventoryEntityId?: string | null;
  qualityIssueId?: string | null;
  actorType: TriageActorType;
  actorId?: string | null;
  outcome: TriageOutcome;
  score: DiscoveryTriageScore;
  evidencePacket: DiscoveryEvidencePacket;
  proposedRule?: DiscoveryTriageProposedRule | null;
  selectedTaxonomyNodeId?: string | null;
  selectedIdentity?: Record<string, unknown> | null;
  appliedRuleId?: string | null;
  requiresHumanReview: boolean;
  humanReviewedAt?: Date | null;
};

export type DiscoveryTriageClient = {
  discoveryTriageDecision: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export const DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS: DiscoveryTriageThresholds = {
  deterministicAutoApply: 0.95,
  coworkerAutoApply: 0.9,
  taxonomyGapIdentity: 0.85,
  humanReviewFloor: 0.6,
  ambiguityMargin: 0.05,
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "number" ? entry : Number(entry)))
    .filter((entry) => Number.isFinite(entry));
}

function getPrometheusLabels(properties: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(properties.prometheusLabels)) {
    return properties.prometheusLabels;
  }

  const labelKeys = ["job", "instance", "health", "namespace", "service"];
  const labels = Object.fromEntries(
    labelKeys
      .filter((key) => key in properties)
      .map((key) => [key, properties[key]]),
  );

  return labels;
}

function getSnmpSystemFields(properties: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(properties.snmpSystemFields)) {
    return properties.snmpSystemFields;
  }

  const snmpKeys = ["sysName", "sysDescr", "sysObjectId", "sysLocation"];
  return Object.fromEntries(
    snmpKeys
      .filter((key) => key in properties)
      .map((key) => [key, properties[key]]),
  );
}

function countIndependentSignals(protocolEvidence: DiscoveryProtocolEvidence): number {
  let count = 0;

  if (protocolEvidence.ports.length > 0) count += 1;
  if (protocolEvidence.banners.length > 0) count += 1;
  if (Object.keys(protocolEvidence.prometheusLabels).length > 0) count += 1;
  if (protocolEvidence.containerImage || protocolEvidence.containerName) count += 1;
  if (protocolEvidence.processName) count += 1;
  if (protocolEvidence.packageName || protocolEvidence.softwareEvidence.length > 0) count += 1;
  if (Object.keys(protocolEvidence.snmpSystemFields).length > 0) count += 1;
  if (protocolEvidence.macVendor) count += 1;
  if (protocolEvidence.dhcpHints.length > 0) count += 1;
  if (protocolEvidence.mdnsServices.length > 0) count += 1;
  if (protocolEvidence.upnpDescriptors.length > 0) count += 1;
  if (protocolEvidence.netbiosNames.length > 0) count += 1;

  return count;
}

function deriveIdentityCandidates(input: DiscoveryEvidencePacketInput): DiscoveryTriageIdentityCandidate[] {
  if (input.identityCandidates?.length) {
    return [...input.identityCandidates].sort((left, right) => right.score - left.score);
  }

  const label = [input.manufacturer, input.productModel, input.name]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();

  if (!label) {
    return [];
  }

  const confidenceParts = [
    typeof input.confidence === "number" ? input.confidence : null,
    input.manufacturer ? 0.8 : null,
    input.productModel ? 0.85 : null,
    input.observedVersion ? 0.8 : null,
  ].filter((part): part is number => typeof part === "number");

  const score = confidenceParts.length
    ? confidenceParts.reduce((sum, part) => sum + part, 0) / confidenceParts.length
    : input.name.trim().length > 0
      ? 0.45
      : 0.35;

  return [
    {
      identity: label,
      score: clampScore(score),
      manufacturer: input.manufacturer ?? null,
      model: input.productModel ?? null,
      version: input.normalizedVersion ?? input.observedVersion ?? null,
    },
  ];
}

function getMatchedRuleIds(attributionEvidence: Record<string, unknown> | null | undefined): string[] {
  if (!attributionEvidence) return [];
  const ruleId = attributionEvidence.ruleId;
  return typeof ruleId === "string" && ruleId.trim().length > 0 ? [ruleId] : [];
}

export function buildDiscoveryEvidencePacket(input: DiscoveryEvidencePacketInput): DiscoveryEvidencePacket {
  const properties = input.properties ?? {};
  const protocolEvidence: DiscoveryProtocolEvidence = {
    ports: asNumberArray(properties.ports),
    banners: asStringArray(properties.banners),
    prometheusLabels: getPrometheusLabels(properties),
    containerImage: typeof properties.containerImage === "string" ? properties.containerImage : null,
    containerName: typeof properties.containerName === "string" ? properties.containerName : null,
    processName: typeof properties.processName === "string" ? properties.processName : null,
    packageName: typeof properties.packageName === "string" ? properties.packageName : null,
    softwareEvidence: asStringArray(properties.softwareEvidence),
    snmpSystemFields: getSnmpSystemFields(properties),
    macVendor: typeof properties.macVendor === "string" ? properties.macVendor : null,
    dhcpHints: asStringArray(properties.dhcpHints),
    mdnsServices: asStringArray(properties.mdnsServices),
    upnpDescriptors: asStringArray(properties.upnpDescriptors),
    netbiosNames: asStringArray(properties.netbiosNames),
  };

  const observedSpanHours = clampScore(
    Math.max(0, input.lastSeenAt.getTime() - input.firstSeenAt.getTime()) / 36e5 / 24,
  ) * 24;

  const candidateTaxonomy = [...(input.candidateTaxonomy ?? [])].sort((left, right) => right.score - left.score);
  const identityCandidates = deriveIdentityCandidates(input);

  return {
    inventoryEntity: {
      id: input.id,
      entityKey: input.entityKey,
      entityType: input.entityType,
      name: input.name,
      itemType: input.itemType ?? null,
      source: input.source ?? null,
      firstSeenAt: input.firstSeenAt.toISOString(),
      lastSeenAt: input.lastSeenAt.toISOString(),
    },
    discoveryRunIds: input.discoveryRunIds ?? [],
    collectorNames: input.collectorNames ?? [],
    observedAttributes: properties,
    normalizedDescriptor: buildDiscoveryDescriptor({
      entityKey: input.entityKey,
      entityType: input.entityType,
      itemType: input.itemType ?? undefined,
      name: input.name,
      properties,
    }),
    candidateTaxonomy,
    identityCandidates,
    matchedRuleIds: getMatchedRuleIds(input.attributionEvidence),
    protocolEvidence,
    evidenceFreshness: {
      observedSpanHours: clampScore(observedSpanHours / 24) * 24,
    },
    reproducibility: {
      runCount: input.discoveryRunIds?.length ?? 0,
      observedSpanHours: clampScore(observedSpanHours / 24) * 24,
      consistentSignature: Boolean(
        (input.discoveryRunIds?.length ?? 0) >= 2
          || getMatchedRuleIds(input.attributionEvidence).length > 0,
      ),
    },
    redactionStatus: "unverified",
    policyRisk: Boolean(input.policyRisk),
    customerSensitive: Boolean(input.customerSensitive),
    hasSuitableTaxonomy: input.hasSuitableTaxonomy ?? candidateTaxonomy.length > 0,
    independentSignalCount: countIndependentSignals(protocolEvidence),
  };
}

function computeAmbiguityMargin(scores: number[]): number {
  if (scores.length < 2) {
    return 1;
  }

  return clampScore(scores[0] - scores[1]);
}

export function scoreDiscoveryTriageCandidate(
  packet: DiscoveryEvidencePacket,
  thresholds: DiscoveryTriageThresholds = DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
): DiscoveryTriageScore {
  const identityScores = packet.identityCandidates.map((candidate) => candidate.score).sort((a, b) => b - a);
  const taxonomyScores = packet.candidateTaxonomy.map((candidate) => candidate.score).sort((a, b) => b - a);

  const signalScore = packet.independentSignalCount >= 3
    ? 1
    : packet.independentSignalCount >= 2
      ? 0.9
      : packet.independentSignalCount >= 1
        ? 0.65
        : 0.35;

  const reproducibilityScore = packet.matchedRuleIds.length > 0
    ? 1
    : packet.reproducibility.runCount >= 3
      ? 1
      : packet.reproducibility.runCount === 2
        ? 0.85
        : packet.reproducibility.runCount === 1
          ? 0.65
          : packet.reproducibility.observedSpanHours >= 24
            ? 0.6
            : 0.35;

  const identityConfidence = clampScore(
    Math.max(identityScores[0] ?? 0, signalScore >= thresholds.humanReviewFloor ? signalScore * 0.9 : 0),
  );

  return {
    identityConfidence,
    taxonomyConfidence: clampScore(taxonomyScores[0] ?? 0),
    evidenceCompleteness: clampScore(signalScore),
    reproducibilityScore: clampScore(reproducibilityScore),
    identityAmbiguityMargin: computeAmbiguityMargin(identityScores),
    taxonomyAmbiguityMargin: computeAmbiguityMargin(taxonomyScores),
  };
}

export function resolveDiscoveryTriageOutcome(
  score: DiscoveryTriageScore,
  packet: DiscoveryEvidencePacket,
  thresholds: DiscoveryTriageThresholds = DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
): TriageOutcome {
  const ambiguityBlocksAutoApply = score.identityAmbiguityMargin < thresholds.ambiguityMargin
    || score.taxonomyAmbiguityMargin < thresholds.ambiguityMargin;
  const evidenceReady = score.evidenceCompleteness >= thresholds.humanReviewFloor
    && score.reproducibilityScore >= thresholds.humanReviewFloor;

  if (score.identityConfidence < thresholds.humanReviewFloor || score.evidenceCompleteness < thresholds.humanReviewFloor) {
    return "needs-more-evidence";
  }

  if (!packet.hasSuitableTaxonomy && score.identityConfidence >= thresholds.taxonomyGapIdentity && evidenceReady) {
    return "taxonomy-gap";
  }

  if (
    !ambiguityBlocksAutoApply
    && packet.hasSuitableTaxonomy
    && score.identityConfidence >= thresholds.deterministicAutoApply
    && score.taxonomyConfidence >= thresholds.deterministicAutoApply
    && score.evidenceCompleteness >= thresholds.coworkerAutoApply
    && score.reproducibilityScore >= thresholds.coworkerAutoApply
  ) {
    return "auto-attributed";
  }

  if (
    !ambiguityBlocksAutoApply
    && packet.hasSuitableTaxonomy
    && score.identityConfidence >= thresholds.coworkerAutoApply
    && score.taxonomyConfidence >= thresholds.coworkerAutoApply
    && evidenceReady
  ) {
    return "auto-attributed";
  }

  return "human-review";
}

export function shouldAutoApplyTriageDecision(
  score: DiscoveryTriageScore,
  packet: DiscoveryEvidencePacket,
  thresholds: DiscoveryTriageThresholds = DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
): boolean {
  if (packet.policyRisk || packet.customerSensitive || !packet.hasSuitableTaxonomy) {
    return false;
  }

  if (score.identityAmbiguityMargin < thresholds.ambiguityMargin || score.taxonomyAmbiguityMargin < thresholds.ambiguityMargin) {
    return false;
  }

  if (packet.independentSignalCount < 2 && packet.matchedRuleIds.length === 0) {
    return false;
  }

  return resolveDiscoveryTriageOutcome(score, packet, thresholds) === "auto-attributed";
}

export function synthesizeDiscoveryFingerprintRule(
  packet: DiscoveryEvidencePacket,
  score: DiscoveryTriageScore,
  thresholds: DiscoveryTriageThresholds = DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
): DiscoveryTriageProposedRule | null {
  const leadingTaxonomy = packet.candidateTaxonomy[0];
  const leadingIdentity = packet.identityCandidates[0];

  if (!leadingTaxonomy || !leadingIdentity) {
    return null;
  }

  const requiredSignals: Array<{ signal: string; value: unknown }> = [];
  if (Object.keys(packet.protocolEvidence.prometheusLabels).length > 0) {
    requiredSignals.push({ signal: "prometheusLabels", value: packet.protocolEvidence.prometheusLabels });
  }
  if (packet.protocolEvidence.processName) {
    requiredSignals.push({ signal: "processName", value: packet.protocolEvidence.processName });
  }
  if (packet.protocolEvidence.containerImage) {
    requiredSignals.push({ signal: "containerImage", value: packet.protocolEvidence.containerImage });
  }
  if (packet.protocolEvidence.packageName) {
    requiredSignals.push({ signal: "packageName", value: packet.protocolEvidence.packageName });
  }
  if (requiredSignals.length === 0 && packet.matchedRuleIds[0]) {
    requiredSignals.push({ signal: "matchedRuleId", value: packet.matchedRuleIds[0] });
  }

  return {
    ruleType: "discovery-fingerprint",
    requiredSignals,
    taxonomyNodeId: leadingTaxonomy.nodeId,
    identity: {
      label: leadingIdentity.identity,
      manufacturer: leadingIdentity.manufacturer ?? null,
      model: leadingIdentity.model ?? null,
      version: leadingIdentity.version ?? null,
    },
    confidenceFloor: score.identityConfidence >= thresholds.deterministicAutoApply
      && score.taxonomyConfidence >= thresholds.deterministicAutoApply
      ? thresholds.deterministicAutoApply
      : thresholds.coworkerAutoApply,
    redactionStatus: packet.redactionStatus,
  };
}

export async function recordDiscoveryTriageDecision(
  client: DiscoveryTriageClient,
  decision: DiscoveryTriageDecisionInput,
): Promise<unknown> {
  return client.discoveryTriageDecision.create({
    data: {
      decisionId: decision.decisionId,
      inventoryEntityId: decision.inventoryEntityId ?? null,
      qualityIssueId: decision.qualityIssueId ?? null,
      actorType: decision.actorType,
      actorId: decision.actorId ?? null,
      outcome: decision.outcome,
      identityConfidence: decision.score.identityConfidence,
      taxonomyConfidence: decision.score.taxonomyConfidence,
      evidenceCompleteness: decision.score.evidenceCompleteness,
      reproducibilityScore: decision.score.reproducibilityScore,
      selectedTaxonomyNodeId: decision.selectedTaxonomyNodeId ?? null,
      selectedIdentity: decision.selectedIdentity ?? null,
      evidencePacket: decision.evidencePacket,
      proposedRule: decision.proposedRule ?? null,
      appliedRuleId: decision.appliedRuleId ?? null,
      requiresHumanReview: decision.requiresHumanReview,
      humanReviewedAt: decision.humanReviewedAt ?? null,
    },
  });
}
