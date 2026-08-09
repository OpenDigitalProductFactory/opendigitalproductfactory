import {
  endpointForCollector,
  type DiscoveryCollectorType,
} from "./endpoint";

export type GatewayEvidenceInput = {
  id: string;
  entityKey: string;
  name: string;
  manufacturer: string | null;
  productModel: string | null;
  confidence: number | null;
  properties: unknown;
};

export type GatewayCandidate = {
  entityId: string;
  entityKey: string;
  name: string;
  address: string | null;
  manufacturer: string | null;
  model: string | null;
  confidence: number | null;
  evidence: string[];
  recommendedCollector: DiscoveryCollectorType;
  recommendation: string;
  canonicalEndpoint: string | null;
  matchesDetectedGateway: boolean;
  usable: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function evidenceText(input: GatewayEvidenceInput, properties: Record<string, unknown>): string {
  const values = [
    input.entityKey,
    input.name,
    input.manufacturer,
    input.productModel,
    firstString(properties, ["vendor", "manufacturer", "model", "modelName"]),
    firstString(properties, ["discoveredVia", "sourceKind", "protocol", "sysDescr", "sysObjectId"]),
  ];
  return values.filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
}

function recommendationFor(input: GatewayEvidenceInput, properties: Record<string, unknown>): {
  collector: DiscoveryCollectorType;
  reason: string;
} {
  const text = evidenceText(input, properties);
  if (text.includes("ubiquiti") || text.includes("unifi")) {
    return {
      collector: "unifi",
      reason: "DPF identified UniFi/Ubiquiti evidence for this gateway.",
    };
  }
  if (
    input.entityKey.toLowerCase().startsWith("snmp:")
    || typeof properties.sysObjectId === "string"
    || text.includes(" snmp")
  ) {
    return {
      collector: "snmp",
      reason: "DPF observed SNMP evidence for this gateway.",
    };
  }
  return {
    collector: "arp_scan",
    reason: "No management API was identified; start with a safe local subnet scan.",
  };
}

function buildEvidence(input: GatewayEvidenceInput, properties: Record<string, unknown>): string[] {
  const evidence: string[] = [];
  const manufacturer = input.manufacturer
    ?? firstString(properties, ["vendor", "manufacturer"]);
  const model = input.productModel
    ?? firstString(properties, ["model", "modelName"]);
  if (manufacturer) evidence.push(`Manufacturer: ${manufacturer}`);
  if (model) evidence.push(`Model: ${model}`);
  const discovery = firstString(properties, ["discoveredVia", "sourceKind", "protocol"]);
  if (discovery) evidence.push(`Observed through ${discovery}`);
  if (typeof input.confidence === "number") {
    evidence.push(`Identification confidence ${Math.round(Math.max(0, Math.min(1, input.confidence)) * 100)}%`);
  }
  return evidence;
}

function sameAddress(left: string | null, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const clean = (value: string) => value.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return clean(left) === clean(right);
}

export function buildGatewayCandidates(
  inputs: GatewayEvidenceInput[],
  detectedGateway: string | null,
): GatewayCandidate[] {
  const candidates = inputs.map((input): GatewayCandidate => {
    const properties = asRecord(input.properties);
    const address = firstString(properties, ["address", "ip", "host"]);
    const manufacturer = input.manufacturer
      ?? firstString(properties, ["vendor", "manufacturer"]);
    const model = input.productModel
      ?? firstString(properties, ["model", "modelName"]);
    const recommendation = recommendationFor(input, properties);
    const canonicalEndpoint = address
      ? endpointForCollector(recommendation.collector, address)
      : null;

    return {
      entityId: input.id,
      entityKey: input.entityKey,
      name: input.name,
      address,
      manufacturer,
      model,
      confidence: input.confidence,
      evidence: buildEvidence(input, properties),
      recommendedCollector: recommendation.collector,
      recommendation: recommendation.reason,
      canonicalEndpoint,
      matchesDetectedGateway: sameAddress(address, detectedGateway),
      usable: canonicalEndpoint !== null,
    };
  });

  const collectorRank: Record<DiscoveryCollectorType, number> = {
    unifi: 3,
    snmp: 2,
    arp_scan: 1,
  };
  const identityRank = (candidate: GatewayCandidate): number => (
    collectorRank[candidate.recommendedCollector] * 100
    + (candidate.manufacturer ? 20 : 0)
    + (candidate.model ? 10 : 0)
    + Math.round((candidate.confidence ?? 0) * 10)
  );
  const byPhysicalEndpoint = new Map<string, GatewayCandidate>();
  for (const candidate of candidates) {
    const key = candidate.address
      ? `address:${candidate.address.trim().toLowerCase()}`
      : `entity:${candidate.entityId}`;
    const current = byPhysicalEndpoint.get(key);
    if (!current) {
      byPhysicalEndpoint.set(key, candidate);
      continue;
    }

    const preferred = identityRank(candidate) > identityRank(current) ? candidate : current;
    const other = preferred === candidate ? current : candidate;
    byPhysicalEndpoint.set(key, {
      ...preferred,
      evidence: [...new Set([...preferred.evidence, ...other.evidence])],
      matchesDetectedGateway: preferred.matchesDetectedGateway || other.matchesDetectedGateway,
    });
  }

  return [...byPhysicalEndpoint.values()].sort((left, right) => {
    if (left.matchesDetectedGateway !== right.matchesDetectedGateway) {
      return left.matchesDetectedGateway ? -1 : 1;
    }
    if (left.usable !== right.usable) return left.usable ? -1 : 1;
    const confidenceDelta = (right.confidence ?? 0) - (left.confidence ?? 0);
    if (confidenceDelta !== 0) return confidenceDelta;
    return left.name.localeCompare(right.name);
  });
}

export function choosePreselectedGateway(candidates: GatewayCandidate[]): string | null {
  const usable = candidates.filter((candidate) => candidate.usable);
  if (usable.length === 1) return usable[0].entityId;
  const detected = usable.filter((candidate) => candidate.matchesDetectedGateway);
  return detected.length === 1 ? detected[0].entityId : null;
}
