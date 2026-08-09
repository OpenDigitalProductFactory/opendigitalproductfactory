import {
  endpointForCollector,
  normalizeDiscoveryEndpoint,
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

export type GatewayConnectionEvidence = {
  collectorType: string;
  endpointUrl: string;
  status: string;
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

function recommendationFor(
  input: GatewayEvidenceInput,
  properties: Record<string, unknown>,
  connection: GatewayConnectionEvidence | null,
): {
  collector: DiscoveryCollectorType;
  reason: string;
} {
  if (connection?.status === "active" && connection.collectorType === "unifi") {
    return {
      collector: "unifi",
      reason: "DPF has an active UniFi connection to this physical device.",
    };
  }
  if (connection?.status === "active" && connection.collectorType === "snmp") {
    return {
      collector: "snmp",
      reason: "DPF has an active SNMP connection to this physical device.",
    };
  }
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

function buildEvidence(
  input: GatewayEvidenceInput,
  properties: Record<string, unknown>,
  connection: GatewayConnectionEvidence | null,
): string[] {
  const evidence: string[] = [];
  if (connection?.status === "active") {
    const label = connection.collectorType === "unifi"
      ? "UniFi"
      : connection.collectorType.toUpperCase();
    evidence.push(`Active ${label} connection targets this device`);
  }
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

function connectionAddress(connection: GatewayConnectionEvidence): string | null {
  if (connection.collectorType !== "unifi" && connection.collectorType !== "snmp") {
    return null;
  }
  const collectorType = connection.collectorType;
  const normalized = normalizeDiscoveryEndpoint(connection.endpointUrl, collectorType);
  if (!normalized.ok) return null;
  try {
    return new URL(
      collectorType === "unifi" ? normalized.value : `http://${normalized.value}`,
    ).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function gatewayConnectionAddresses(
  connections: GatewayConnectionEvidence[],
): string[] {
  return [...new Set(
    connections
      .map(connectionAddress)
      .filter((address): address is string => address !== null),
  )];
}

export function gatewayEvidenceWhere(connectionAddresses: string[]) {
  return {
    OR: [
      { entityType: { in: ["gateway", "router"] } },
      ...connectionAddresses.map((address) => ({
        entityType: "host",
        properties: { path: ["address"], equals: address },
      })),
    ],
  };
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
  connections: GatewayConnectionEvidence[] = [],
): GatewayCandidate[] {
  const connectionsByAddress = new Map<string, GatewayConnectionEvidence>();
  for (const connection of connections) {
    const address = connectionAddress(connection);
    if (!address) continue;
    const current = connectionsByAddress.get(address);
    if (!current || (current.status !== "active" && connection.status === "active")) {
      connectionsByAddress.set(address, connection);
    }
  }

  const candidates = inputs.map((input): GatewayCandidate => {
    const properties = asRecord(input.properties);
    const address = firstString(properties, ["address", "ip", "host"]);
    const connection = address
      ? connectionsByAddress.get(address.toLowerCase()) ?? null
      : null;
    const manufacturer = input.manufacturer
      ?? firstString(properties, ["vendor", "manufacturer"]);
    const model = input.productModel
      ?? firstString(properties, ["model", "modelName"]);
    const recommendation = recommendationFor(input, properties, connection);
    const canonicalEndpoint = address
      ? endpointForCollector(recommendation.collector, address)
      : null;
    const displayName = connection?.status === "active"
      && connection.collectorType === "unifi"
      && /^LAN Host\b/i.test(input.name)
      ? `UniFi gateway ${address}`
      : input.name;

    return {
      entityId: input.id,
      entityKey: input.entityKey,
      name: displayName,
      address,
      manufacturer,
      model,
      confidence: input.confidence,
      evidence: buildEvidence(input, properties, connection),
      recommendedCollector: recommendation.collector,
      recommendation: recommendation.reason,
      canonicalEndpoint,
      matchesDetectedGateway: sameAddress(address, detectedGateway) || connection?.status === "active",
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
