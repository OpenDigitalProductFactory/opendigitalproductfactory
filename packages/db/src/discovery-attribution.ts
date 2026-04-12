const LOW_CONFIDENCE_THRESHOLD = 0.55;
const STOP_WORDS = new Set([
  "and",
  "app",
  "application",
  "engine",
  "for",
  "internal",
  "management",
  "platform",
  "portal",
  "service",
  "services",
  "system",
  "the",
]);

export type TaxonomyNodeCandidate = {
  nodeId: string;
  name: string;
  portfolioSlug?: string | null;
  description?: string | null;
  enrichmentText?: string | null;
};

export type RankedTaxonomyCandidate = TaxonomyNodeCandidate & {
  score: number;
  evidence: string[];
};

export type InventoryAttributionInput = {
  entityKey: string;
  entityType: string;
  itemType?: string;
  name: string;
  properties?: Record<string, unknown>;
};

export type InventoryAttributionResult = {
  taxonomyNodeId: string | null;
  portfolioSlug: string | null;
  attributionMethod: "rule" | "heuristic";
  attributionStatus: "attributed" | "needs_review";
  confidence: number;
  candidateTaxonomy: RankedTaxonomyCandidate[];
  evidence: {
    descriptor: string;
    ruleId?: string;
    matchedSignals: string[];
  };
};

export type InventoryQualityEntityInput = {
  entityKey: string;
  entityType: string;
  attributionStatus: "attributed" | "needs_review" | "unmapped" | "stale" | "dismissed";
  attributionMethod?: "rule" | "heuristic" | "manual" | "ai_proposed" | null;
  attributionConfidence?: number | null;
  candidateTaxonomy?: Array<{ nodeId: string; score: number }> | null;
  taxonomyNodeId?: string | null;
  digitalProductId?: string | null;
  qualityStatus?: "warning" | "error";
};

export type InventoryQualityRelationshipInput = {
  relationshipKey: string;
  relationshipType: string;
  status?: "active" | "stale";
};

export type InventoryQualityIssue = {
  issueKey: string;
  issueType: string;
  severity: "warn" | "error";
  status: "open";
  summary: string;
  inventoryEntityKey?: string;
  inventoryRelationshipKey?: string;
};

export type InventoryQualityEvaluation = {
  issues: InventoryQualityIssue[];
};

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeToken(value)
    .split(/\s+/)
    .map((token) => token.replace(/s$/, ""))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function toSentence(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toSentence(entry)).join(" ");
  }

  if (value && typeof value === "object") {
    return Object.values(value).map((entry) => toSentence(entry)).join(" ");
  }

  return "";
}

function resolvePortfolioSlug(node: TaxonomyNodeCandidate): string | null {
  if (node.portfolioSlug) {
    return node.portfolioSlug;
  }

  const [root] = node.nodeId.split("/");
  return root || null;
}

function findRuleMatch(
  input: InventoryAttributionInput,
  taxonomyNodes: TaxonomyNodeCandidate[],
): InventoryAttributionResult | null {
  const itemType = (input.itemType ?? input.entityType).toLowerCase();
  const matchByNodeId = (matcher: (nodeId: string) => boolean) =>
    taxonomyNodes.find((node) => matcher(node.nodeId.toLowerCase()));

  let node: TaxonomyNodeCandidate | undefined;
  let ruleId: string | undefined;

  if (input.entityType === "host" || itemType === "host") {
    node = matchByNodeId((nodeId) => nodeId.endsWith("/servers"));
    ruleId = node ? "foundational_host_servers" : undefined;
  } else if (itemType.includes("docker") || itemType.includes("container")) {
    node = matchByNodeId((nodeId) => nodeId.includes("container_platform"));
    ruleId = node ? "container_platform_runtime" : undefined;
  } else if (itemType.includes("database")) {
    node = matchByNodeId((nodeId) => nodeId.endsWith("/database"));
    ruleId = node ? "foundational_database" : undefined;
  } else if (itemType.includes("network") || itemType === "subnet" || itemType === "gateway" || itemType === "router") {
    node = matchByNodeId((nodeId) => nodeId.includes("network_management"));
    ruleId = node ? "foundational_network" : undefined;
  } else if (itemType === "docker_host") {
    node = matchByNodeId((nodeId) => nodeId.includes("container_platform"))
        ?? matchByNodeId((nodeId) => nodeId.endsWith("/servers"));
    ruleId = node ? "foundational_docker_host" : undefined;
  } else if (itemType.includes("storage")) {
    node = matchByNodeId((nodeId) => nodeId.endsWith("/online_storage"));
    ruleId = node ? "foundational_storage" : undefined;
  } else if (itemType.includes("monitoring") || itemType.includes("observability")) {
    node = matchByNodeId((nodeId) => nodeId.includes("observability_platform"));
    ruleId = node ? "foundational_observability" : undefined;
  } else if (itemType.includes("ai_service")) {
    node = matchByNodeId((nodeId) => nodeId.includes("ai_and_agent_platform"))
        ?? matchByNodeId((nodeId) => nodeId.includes("platform_services"));
    ruleId = node ? "foundational_ai_service" : undefined;
  } else if (itemType === "application") {
    node = matchByNodeId((nodeId) => nodeId.endsWith("/platform_services"));
    ruleId = node ? "foundational_application" : undefined;
  }

  if (!node || !ruleId) {
    return null;
  }

  return {
    taxonomyNodeId: node.nodeId,
    portfolioSlug: resolvePortfolioSlug(node),
    attributionMethod: "rule",
    attributionStatus: "attributed",
    confidence: 0.98,
    candidateTaxonomy: [
      {
        ...node,
        score: 0.98,
        evidence: [ruleId],
      },
    ],
    evidence: {
      descriptor: buildDiscoveryDescriptor(input),
      ruleId,
      matchedSignals: [input.entityType, itemType],
    },
  };
}

export function flattenEnrichmentForScoring(enrichment: Record<string, unknown> | null | undefined): string {
  if (!enrichment) return "";
  const parts: string[] = [];
  for (const [key, val] of Object.entries(enrichment)) {
    if (key === "industryMarkets" && val && typeof val === "object") {
      for (const text of Object.values(val as Record<string, string>)) {
        if (text) parts.push(text);
      }
    } else if (typeof val === "string" && val.trim()) {
      parts.push(val);
    }
  }
  return parts.join(" ");
}

export function buildDiscoveryDescriptor(input: InventoryAttributionInput): string {
  const propertiesText = toSentence(input.properties ?? {});
  return [input.entityType, input.itemType, input.name, propertiesText]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

export function scoreTaxonomyCandidates(
  descriptor: string,
  taxonomyNodes: TaxonomyNodeCandidate[],
): RankedTaxonomyCandidate[] {
  const descriptorText = normalizeToken(descriptor);
  const descriptorTokens = tokenize(descriptor);
  const descriptorTokenSet = new Set(descriptorTokens);

  return taxonomyNodes
    .map((node) => {
      // Core label: name + path segments (high weight)
      const coreText = `${node.name} ${node.nodeId.split("/").join(" ")}`;
      const coreTokens = tokenize(coreText);
      const coreOverlap = coreTokens.filter((token) => descriptorTokenSet.has(token));

      // Enrichment text: description + offering/market context (lower weight to prevent dilution)
      const enrichmentParts = [node.description ?? "", node.enrichmentText ?? ""].filter(Boolean).join(" ");
      const enrichmentTokens = tokenize(enrichmentParts);
      const enrichmentTokenSet = new Set(enrichmentTokens);
      // Only count enrichment tokens that are NOT already in the core
      const coreTokenSet = new Set(coreTokens);
      const enrichmentOnlyTokens = enrichmentTokens.filter((t) => !coreTokenSet.has(t));
      const enrichmentOnlyOverlap = enrichmentOnlyTokens.filter((t) => descriptorTokenSet.has(t));

      // Combined coverage: core tokens at full weight, enrichment-only at 0.5x
      const allTokens = coreTokens.length + enrichmentOnlyTokens.length * 0.5;
      const allOverlap = coreOverlap.length + enrichmentOnlyOverlap.length * 0.5;
      const nodeCoverage = allTokens > 0 ? allOverlap / allTokens : 0;

      // Descriptor coverage: how much of the query is explained by this node
      const combinedTokenSet = new Set([...coreTokenSet, ...enrichmentTokenSet]);
      const descriptorOverlap = descriptorTokens.filter((t) => combinedTokenSet.has(t));
      const descriptorCoverage = descriptorTokens.length > 0 ? descriptorOverlap.length / descriptorTokens.length : 0;

      const phraseBonus = descriptorText.includes(normalizeToken(node.name)) ? 0.2 : 0;
      const score = Math.min(0.95, Number((nodeCoverage * 0.7 + descriptorCoverage * 0.3 + phraseBonus).toFixed(3)));

      const evidence = [...coreOverlap, ...enrichmentOnlyOverlap];
      return {
        ...node,
        score,
        evidence: evidence.length > 0 ? evidence : ["fallback_candidate"],
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

export function attributeInventoryEntity(
  input: InventoryAttributionInput,
  taxonomyNodes: TaxonomyNodeCandidate[],
): InventoryAttributionResult {
  const ruleMatch = findRuleMatch(input, taxonomyNodes);
  if (ruleMatch) {
    return ruleMatch;
  }

  const descriptor = buildDiscoveryDescriptor(input);
  const ranked = scoreTaxonomyCandidates(descriptor, taxonomyNodes);
  const best = ranked[0] ?? null;

  if (!best || best.score < LOW_CONFIDENCE_THRESHOLD) {
    return {
      taxonomyNodeId: null,
      portfolioSlug: null,
      attributionMethod: "heuristic",
      attributionStatus: "needs_review",
      confidence: best?.score ?? 0,
      candidateTaxonomy: ranked,
      evidence: {
        descriptor,
        matchedSignals: best?.evidence ?? [],
      },
    };
  }

  return {
    taxonomyNodeId: best.nodeId,
    portfolioSlug: resolvePortfolioSlug(best),
    attributionMethod: "heuristic",
    attributionStatus: "attributed",
    confidence: best.score,
    candidateTaxonomy: ranked,
    evidence: {
      descriptor,
      matchedSignals: best.evidence,
    },
  };
}

export function evaluateInventoryQuality(
  entities: InventoryQualityEntityInput[],
  relationships: InventoryQualityRelationshipInput[] = [],
): InventoryQualityEvaluation {
  const issues: InventoryQualityIssue[] = [];

  for (const entity of entities) {
    if (entity.attributionStatus === "needs_review" || entity.attributionStatus === "unmapped") {
      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:attribution_missing`,
        issueType: "attribution_missing",
        severity: entity.qualityStatus === "error" ? "error" : "warn",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} requires taxonomy or product attribution review`,
        inventoryEntityKey: entity.entityKey,
      });
    }

    if (
      (entity.attributionStatus === "needs_review" || entity.attributionStatus === "unmapped")
      && (entity.attributionConfidence ?? 0) < LOW_CONFIDENCE_THRESHOLD
      && (entity.candidateTaxonomy?.length ?? 0) > 0
    ) {
      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:taxonomy_low_confidence`,
        issueType: "taxonomy_attribution_low_confidence",
        severity: "warn",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} has low-confidence taxonomy attribution candidates`,
        inventoryEntityKey: entity.entityKey,
      });
    }

    if (entity.attributionStatus === "stale") {
      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:stale`,
        issueType: "stale_entity",
        severity: "warn",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} was not confirmed in the latest discovery run`,
        inventoryEntityKey: entity.entityKey,
      });
    }
  }

  for (const relationship of relationships) {
    if (relationship.status === "stale") {
      issues.push({
        issueKey: `inventory_relationship:${relationship.relationshipKey}:stale`,
        issueType: "stale_relationship",
        severity: "warn",
        status: "open",
        summary: `${relationship.relationshipType} relationship ${relationship.relationshipKey} is stale`,
        inventoryRelationshipKey: relationship.relationshipKey,
      });
    }
  }

  return { issues };
}

