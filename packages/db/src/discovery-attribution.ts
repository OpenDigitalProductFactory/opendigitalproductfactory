import { isDockerOriginEntityKey, isDockerOriginRelationshipKey } from "./docker-origin";
import {
  classifyEntityObservation,
  classifyRelationshipObservation,
} from "./estate-observation-class";
import type { QualityIssueType } from "./quality-issue-registry";

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
  attributionMethod?: "rule" | "heuristic" | "manual" | "ai-proposed" | null;
  attributionConfidence?: number | null;
  candidateTaxonomy?: Array<{ nodeId: string; score: number }> | null;
  taxonomyNodeId?: string | null;
  digitalProductId?: string | null;
  qualityStatus?: "warning" | "error";
  manufacturer?: string | null;
  observedVersion?: string | null;
  normalizedVersion?: string | null;
  supportStatus?: string | null;
  hasSoftwareEvidence?: boolean;
  normalizationStatus?: string | null;
};

export type InventoryQualityRelationshipInput = {
  relationshipKey: string;
  relationshipType: string;
  status?: "active" | "stale";
};

export type InventoryQualityIssue = {
  issueKey: string;
  // Typed against the lifecycle registry, NOT `string`: a detector that emits an
  // unregistered type is now a compile error rather than a row with no declared
  // way to close. This chain (evaluateInventoryQuality -> discovery-sync's direct
  // prisma.upsert) is exactly how 8 undeclared types reached the live database.
  issueType: QualityIssueType;
  severity: "warn" | "error";
  status: "open";
  summary: string;
  inventoryEntityKey?: string;
  inventoryRelationshipKey?: string;
};

export type InventoryQualityEvaluation = {
  issues: InventoryQualityIssue[];
  /**
   * Issue keys this pass proved are NO LONGER WARRANTED — the exact negation of
   * the emission conditions above, for entities this sweep actually examined.
   *
   * Why this exists: `QualityIssueContract.autoResolveWhen` declared each type's
   * close condition in PROSE that no code path read. Only stale_entity /
   * stale_relationship ever had a real implementation. So `lifecycle_unverified`
   * kept saying "resolves when supportStatus becomes known" while 67 rows sat
   * open on entities that already reported `supported`, and
   * `catalog_match_ambiguous` kept 67 open on entities that already had a
   * manufacturer — 134 of 196 open rows (68%) whose stated condition was
   * already true.
   *
   * Why it is computed HERE and not in the drift sweep: the resolve condition is
   * the negation of the emit condition, so deriving both in one pass from one set
   * of facts makes drift between them structurally impossible. The sweep could
   * not do it correctly anyway — some warranting facts (evidence-derived
   * normalizationStatus) never reach the InventoryEntity row, and a predicate
   * blind to a warranting condition would close real signal.
   *
   * Bounded by construction: only entities in THIS sweep are reconciled. An
   * entity nobody observed cannot have its facts re-evaluated, and each source
   * clears its own entities on its own cadence.
   */
  resolvedIssueKeys: string[];
};

/**
 * Entity-subject issue types whose warrant is recomputed on every sweep. Each
 * must have BOTH an emit branch and a matching not-warranted branch in
 * `evaluateInventoryQuality`; the registry conformance test asserts the set.
 */
export const RECONCILED_ENTITY_ISSUE_TYPES = [
  "attribution_missing",
  "taxonomy_attribution_low_confidence",
  "lifecycle_unverified",
  "catalog_match_ambiguous",
] as const satisfies readonly QualityIssueType[];

const IDENTITY_OPTIONAL_ENTITY_TYPES = new Set([
  "network_interface",
  "subnet",
  "vlan",
]);

/**
 * Every issue-key suffix the entity loop below can open for one subject.
 *
 * Suffixes, not issue types: `taxonomy_attribution_low_confidence` is keyed
 * `:taxonomy_low_confidence`, so deriving keys from the type names would silently
 * miss it.
 */
const ENTITY_ISSUE_KEY_SUFFIXES = [
  "attribution_missing",
  "taxonomy_low_confidence",
  "lifecycle_unverified",
  "catalog_match_ambiguous",
  "stale",
] as const;

/**
 * Resolve EVERY issue this loop can open for a subject it is about to skip.
 *
 * Why suppression must resolve rather than `continue`: a bare `continue` puts the
 * subject in neither `issues` nor `resolvedIssueKeys`, so any row opened before
 * the suppression rule existed has no close path and stays open forever. That is
 * not hypothetical — tightening the Docker guard to match `:container:`
 * positionally correctly stopped NEW rows for `monitoring_service:container:<id>`
 * but stranded 19 already-open ones, which is exactly the 5-row residual in
 * BI-A3D12F85 that no close condition explained.
 *
 * Suppressing a subject means "the platform asks nothing of this thing", and the
 * honest expression of that is an explicit resolve, not silence. Every future
 * skip in this loop must call this instead of `continue`ing bare.
 */
function resolveAllEntityIssues(entityKey: string, resolvedIssueKeys: string[]): void {
  for (const suffix of ENTITY_ISSUE_KEY_SUFFIXES) {
    resolvedIssueKeys.push(`inventory_entity:${entityKey}:${suffix}`);
  }
}

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

/**
 * A `host` is only a confident "server / compute node" when a real OS/compute
 * signal corroborates it. The host collector reports one (os / platform /
 * kernel / uptime …); a network sweep (ARP/UniFi) reports only a vendor + MAC.
 *
 * Why this gate exists: the coarse `host -> /servers` rule used to fire on ANY
 * host at 0.98 confidence. Combined with the fingerprint layer not running on
 * the ingestion paths, every real-network device (a Whirlpool appliance, an
 * Echo, a Nest) was filed as a confidently-identified "server". Now that the
 * fingerprint layer runs first, a host WITHOUT a compute signal that reaches
 * this heuristic means the fingerprint layer already MISSED — so it must not be
 * masked as a confident server. It falls through to heuristic scoring, which
 * routes an unidentified device to `needs_review`. (BI-BAF38ED3.)
 */
const HOST_COMPUTE_SIGNAL_KEYS = [
  "os",
  "osname",
  "os_name",
  "operatingsystem",
  "operating_system",
  "platform",
  "kernel",
  "kernelversion",
  "osversion",
  "os_version",
  "distro",
  "distribution",
  "uptime",
  "uptimeseconds",
  "cpucount",
  "cpucores",
  "memorybytes",
  "hostrole",
  "serverrole",
];

export function hostHasComputeSignal(input: InventoryAttributionInput): boolean {
  const itemType = (input.itemType ?? input.entityType).toLowerCase();
  // An explicitly typed server/compute item is a compute host by definition.
  if (itemType.includes("server") || itemType.includes("compute") || itemType.includes("vm")
    || itemType.includes("virtual_machine") || itemType.includes("hypervisor")) {
    return true;
  }
  const properties = input.properties;
  if (!properties || typeof properties !== "object") {
    return false;
  }
  const keys = Object.keys(properties as Record<string, unknown>);
  return keys.some((key) => {
    const value = (properties as Record<string, unknown>)[key];
    // A present-but-empty signal key (null / "" ) does not corroborate compute.
    if (value === null || value === undefined || value === "") {
      return false;
    }
    return HOST_COMPUTE_SIGNAL_KEYS.includes(key.toLowerCase());
  });
}

// Property keys that mark a row as observed by a network sweep (ARP / UniFi /
// SNMP) — i.e. "seen on the wire" by its MAC/OUI vendor, as opposed to a host
// the bootstrap host-collector ran on (which reports os/hostname, not raw MAC).
const NETWORK_SWEEP_EVIDENCE_KEYS = ["mac", "macaddress", "mac_address", "vendor", "oui_vendor", "vendoroui", "oui"];

/**
 * True when a `host` is an UNIDENTIFIED network-sweep device: it carries
 * OUI/MAC network-sweep evidence (so it was seen on the wire, not run by the
 * host collector) yet has no corroborating compute signal. Such a row reaching
 * the coarse heuristic means the fingerprint layer already MISSED it, so it must
 * not be filed as a confident `/servers` — it belongs in needs_review.
 *
 * A bootstrap/host-collector host (os/hostname, no raw MAC) and a corroborated
 * compute host both return false and keep the servers default. (BI-BAF38ED3.)
 */
export function isUnidentifiedNetworkSweepHost(input: InventoryAttributionInput): boolean {
  const entityType = (input.entityType ?? "").toLowerCase();
  const itemType = (input.itemType ?? input.entityType ?? "").toLowerCase();
  const isHostLike = entityType === "host" || itemType === "host" || entityType === "network_client";
  if (!isHostLike) {
    return false;
  }
  if (hostHasComputeSignal(input)) {
    return false;
  }
  const properties = input.properties;
  if (!properties || typeof properties !== "object") {
    return false;
  }
  const props = properties as Record<string, unknown>;
  return Object.keys(props).some((key) => {
    const value = props[key];
    if (value === null || value === undefined || value === "") {
      return false;
    }
    return NETWORK_SWEEP_EVIDENCE_KEYS.includes(key.toLowerCase());
  });
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
    // Default a host to servers UNLESS it is an unidentified network-sweep
    // device (vendor + MAC, no OS, no fingerprint match) — that would be the
    // fingerprint layer's miss masquerading as a confident server. Such a host
    // falls through to heuristic scoring -> needs_review (BI-BAF38ED3).
    if (!isUnidentifiedNetworkSweepHost(input)) {
      node = matchByNodeId((nodeId) => nodeId.endsWith("/servers"));
      ruleId = node ? "foundational_host_servers" : undefined;
    }
  } else if (itemType.includes("docker") || itemType.includes("container")) {
    node = matchByNodeId((nodeId) => nodeId.includes("container_platform"));
    ruleId = node ? "container_platform_runtime" : undefined;
  } else if (itemType.includes("database")) {
    node = matchByNodeId((nodeId) => nodeId.endsWith("/database"));
    ruleId = node ? "foundational_database" : undefined;
  } else if (
    itemType.includes("network") || itemType === "subnet" || itemType === "gateway" || itemType === "router"
    || itemType === "vlan" || itemType === "switch" || itemType === "firewall" || itemType === "load_balancer"
    // The internet uplink (gateway -> ISP) is network connectivity in the most
    // literal sense — and the hop the whole estate depends on.
    || itemType === "wan_uplink"
  ) {
    node = matchByNodeId((nodeId) => nodeId.includes("network_connectivity"))
        ?? matchByNodeId((nodeId) => nodeId.includes("network_management"));
    ruleId = node ? "foundational_network" : undefined;
  } else if (
    itemType === "access_point" || itemType === "wireless_ap" || itemType.includes("wlan") || itemType.includes("wifi")
  ) {
    node = matchByNodeId((nodeId) => nodeId.includes("network_connectivity"))
        ?? matchByNodeId((nodeId) => nodeId.includes("network_management"));
    ruleId = node ? "foundational_wireless_network" : undefined;
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
  const resolvedIssueKeys: string[] = [];

  for (const entity of entities) {
    // Docker-origin entities (containers, bridge-IP hosts, vpnkit
    // gateways) aren't real estate to manage — they spawn one quality
    // issue per row otherwise, drowning the actual signal. Skip the
    // entire issue-generation loop for them. Entity-key heuristics
    // catch every Docker shape without needing a name pass-through.
    if (isDockerOriginEntityKey(entity.entityKey)) {
      resolveAllEntityIssues(entity.entityKey, resolvedIssueKeys);
      continue;
    }

    // Each entity-subject type below emits when warranted and records its key as
    // RESOLVED when not. The else-branch is the executable form of the contract's
    // `autoResolveWhen` prose — same facts, same pass, so the two cannot drift.
    const attributionUnresolved =
      entity.attributionStatus === "needs_review" || entity.attributionStatus === "unmapped";
    if (attributionUnresolved) {
      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:attribution_missing`,
        issueType: "attribution_missing",
        severity: entity.qualityStatus === "error" ? "error" : "warn",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} requires taxonomy or product attribution review`,
        inventoryEntityKey: entity.entityKey,
      });
    } else {
      // "the entity gains a taxonomy or product attribution"
      resolvedIssueKeys.push(`inventory_entity:${entity.entityKey}:attribution_missing`);
    }

    if (
      attributionUnresolved
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
    } else {
      // "attribution confidence rises above the low-confidence threshold" — or the
      // attribution resolved outright, or the candidate list emptied.
      resolvedIssueKeys.push(`inventory_entity:${entity.entityKey}:taxonomy_low_confidence`);
    }

    // The managed/observed split, applied to all three subject-scoped types
    // below. See the `observedEstate` uses for why identity and lifecycle now
    // share the gate that staleness already had.
    const observedEstate = classifyEntityObservation(entity.entityKey) === "observed";

    // Only the MANAGED estate raises an issue when it vanishes. An ARP
    // neighbour, a UniFi client (phone/laptop), or a platform Prometheus target
    // disappearing is normal churn, not an operator-actionable gap — surfacing
    // it produces a permanently-open row nobody can resolve.
    if (
      entity.attributionStatus === "stale"
      && !observedEstate
    ) {
      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:stale`,
        issueType: "stale_entity",
        severity: "warn",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} was not confirmed in the latest discovery run`,
        inventoryEntityKey: entity.entityKey,
      });
    }

    // Lifecycle verification is asked only of the managed estate, for the same
    // reason staleness is. "Verify the support lifecycle of this device" is not a
    // question anyone can answer about a phone that joined the wifi — and the
    // measurement in BI-A3D12F85 shows that is literally the population: every
    // ARP host swept today carries a locally-administered (randomised) MAC, which
    // has no OUI and therefore no vendor, no catalog identity and no lifecycle,
    // by construction rather than by omission. Those rows are unresolvable, not
    // merely unresolved, and 180 of them buried the 21 that describe real gear.
    const normalizedSupportStatus = entity.supportStatus?.trim().toLowerCase() ?? "unknown";
    if (observedEstate || normalizedSupportStatus !== "unknown") {
      // "support lifecycle (supportStatus) becomes known for the entity" — or the
      // subject is observed rather than managed, so it is never asked.
      resolvedIssueKeys.push(`inventory_entity:${entity.entityKey}:lifecycle_unverified`);
    } else {
      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:lifecycle_unverified`,
        issueType: "lifecycle_unverified",
        severity: "warn",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} still needs support lifecycle verification`,
        inventoryEntityKey: entity.entityKey,
      });
    }

    // Identity review is likewise a managed-estate question: see the lifecycle
    // block above. An observed neighbour with no resolvable vendor is not an
    // identity gap the operator can close.
    const identityAmbiguous = !observedEstate
      && !IDENTITY_OPTIONAL_ENTITY_TYPES.has(entity.entityType)
      && (
        !entity.manufacturer
        || (!!entity.observedVersion && !entity.normalizedVersion)
        || entity.normalizationStatus === "needs_review"
      );

    if (identityAmbiguous) {
      const detailParts = [
        !entity.manufacturer ? "manufacturer" : null,
        !!entity.observedVersion && !entity.normalizedVersion ? "normalized version" : null,
        entity.normalizationStatus === "needs_review" ? "catalog match" : null,
      ].filter((part): part is string => Boolean(part));

      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:catalog_match_ambiguous`,
        issueType: "catalog_match_ambiguous",
        severity: entity.hasSoftwareEvidence ? "warn" : "error",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} still needs identity review for ${detailParts.join(", ")}`,
        inventoryEntityKey: entity.entityKey,
      });
    } else {
      // "identity evidence resolves (manufacturer + normalized version + catalog
      // match)" — also covers an entity whose type became identity-optional.
      resolvedIssueKeys.push(`inventory_entity:${entity.entityKey}:catalog_match_ambiguous`);
    }
  }

  for (const relationship of relationships) {
    // Docker-origin relationships (container<->container, container<->docker-net,
    // docker.sock<->container) are platform-internal topology, not operator
    // estate. Every container recreation mints a new 12-hex id, orphaning the old
    // relationshipKey as permanently `stale` — one open stale_relationship issue
    // per orphan that never resolves. Skip issue generation for them, exactly as
    // the entity loop above skips isDockerOriginEntityKey rows.
    //
    // Both skips below RESOLVE the subject's key rather than `continue`ing bare,
    // for the reason given on resolveAllEntityIssues: a suppression that only
    // stops emitting strands every row opened before the rule existed.
    if (isDockerOriginRelationshipKey(relationship.relationshipKey)) {
      resolvedIssueKeys.push(`inventory_relationship:${relationship.relationshipKey}:stale`);
      continue;
    }
    // A relationship is only as durable as its least-durable endpoint: a
    // transient client attached to a managed AP vanishes the moment that client
    // leaves. Managed<->managed topology (AP uplink to switch) still raises.
    if (classifyRelationshipObservation(relationship.relationshipKey) === "observed") {
      resolvedIssueKeys.push(`inventory_relationship:${relationship.relationshipKey}:stale`);
      continue;
    }
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

  // An issue key can only appear on one side: each branch above is an if/else on
  // the same condition, so a key emitted this pass is never also reported
  // resolved. The caller closes `resolvedIssueKeys` and upserts `issues`.
  return { issues, resolvedIssueKeys };
}

