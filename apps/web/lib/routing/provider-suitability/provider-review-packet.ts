import type {
  AiWorkloadClassKey,
  BusinessSuitabilityProfile,
} from "./types";
import { isRecord } from "@/lib/shared/coerce";

export const PROVIDER_REVIEW_PACKET_VERSION = "provider-compliance-review.v1" as const;
export const PROVIDER_REVIEW_PACKET_MAX_BYTES = 10_000;
export const PROVIDER_REVIEW_OBJECTIVE_MAX_BYTES = 14_000;

const REQUESTED_ADVISORY = [
  "regulatory-applicability",
  "account-and-contract-evidence",
  "retention-and-training-treatment",
  "processing-region-and-sovereignty",
  "workload-restrictions",
  "safe-next-action",
] as const;

const WORKLOAD_CLASSES: readonly AiWorkloadClassKey[] = [
  "public-marketing",
  "internal-operations",
  "customer-records",
  "employee-records",
  "payments-finance",
  "health-phi",
  "student-records",
  "legal-privileged",
  "security-logs",
  "criminal-justice",
  "safety-sensitive",
  "youth-sensitive",
  "public-sector-records",
  "regulated-decisioning",
  "source-code",
  "secrets-credentials",
];

type RecommendationStatus = "ready" | "review-needed" | "not-ready";
type RecommendationScope = "company-work" | "public-only" | "blocked";

export type ProviderReviewPacket = {
  schemaVersion: typeof PROVIDER_REVIEW_PACKET_VERSION;
  purpose: "provider-suitability-advice";
  organizationRef: string;
  businessContext: {
    archetypeId: string | null;
    archetypeCategory: string | null;
    jurisdictionBasis: {
      operatesIn: string[];
      sellsTo: string[];
      employsIn: string[];
      dataResidency: string[];
    };
    riskPosture: BusinessSuitabilityProfile["riskPosture"];
  };
  recommendation: {
    status: RecommendationStatus;
    workloadClasses: AiWorkloadClassKey[];
  };
  providerConnections: Array<{
    providerConnectionId: string;
    providerId: string;
    scopes: RecommendationScope[];
    executionChannel: string;
    accountClass: string;
  }>;
  requestedAdvisory: [...typeof REQUESTED_ADVISORY];
};

export type BuildProviderReviewPacketInput = {
  businessProfile: BusinessSuitabilityProfile;
  recommendation: {
    status: RecommendationStatus;
    workloadClasses: readonly AiWorkloadClassKey[];
    items: ReadonlyArray<{
      providerConnectionId: string;
      providerId: string;
      scope: RecommendationScope;
      executionChannel?: string;
      accountClass?: string;
    }>;
  };
};

function boundedUnique(values: readonly string[], max: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort().slice(0, max);
}

/**
 * Build the minimum context AGT-902 needs to review provider suitability.
 * This is deliberately an allowlist projection: display copy, customer data,
 * prompts, attachments, credentials, and contract contents have no output slot.
 */
export function buildProviderReviewPacket(input: BuildProviderReviewPacketInput): ProviderReviewPacket {
  const connections = new Map<string, ProviderReviewPacket["providerConnections"][number]>();
  for (const item of input.recommendation.items) {
    const key = `${item.providerConnectionId}\u0000${item.providerId}`;
    const current = connections.get(key) ?? {
      providerConnectionId: item.providerConnectionId.trim(),
      providerId: item.providerId.trim(),
      scopes: [],
      executionChannel: item.executionChannel ?? "unknown",
      accountClass: item.accountClass ?? "unknown",
    };
    current.scopes = boundedUnique([...current.scopes, item.scope], 3) as RecommendationScope[];
    connections.set(key, current);
  }

  const packet: ProviderReviewPacket = {
    schemaVersion: PROVIDER_REVIEW_PACKET_VERSION,
    purpose: "provider-suitability-advice",
    organizationRef: input.businessProfile.organizationId.trim(),
    businessContext: {
      archetypeId: input.businessProfile.archetypeId?.trim() || null,
      archetypeCategory: input.businessProfile.archetypeCategory?.trim() || null,
      jurisdictionBasis: {
        operatesIn: boundedUnique(input.businessProfile.operatesIn, 20),
        sellsTo: boundedUnique(input.businessProfile.sellsTo, 20),
        employsIn: boundedUnique(input.businessProfile.employsIn, 20),
        dataResidency: boundedUnique(input.businessProfile.dataResidency, 20),
      },
      riskPosture: input.businessProfile.riskPosture,
    },
    recommendation: {
      status: input.recommendation.status,
      workloadClasses: boundedUnique(input.recommendation.workloadClasses, 20) as AiWorkloadClassKey[],
    },
    providerConnections: [...connections.values()]
      .sort((a, b) => a.providerConnectionId.localeCompare(b.providerConnectionId))
      .slice(0, 50),
    requestedAdvisory: [...REQUESTED_ADVISORY],
  };

  const validation = validateProviderReviewPacket(packet);
  if (!validation.success) throw new Error(validation.error);
  return packet;
}

type ValidationResult =
  | { success: true; value: ProviderReviewPacket }
  | { success: false; error: string };

function unknownField(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path = "",
): string | null {
  const field = Object.keys(value).find((key) => !allowed.includes(key));
  return field ? `packet_unknown_field:${path}${field}` : null;
}

function validIdentifier(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9._:/-]+$/.test(value);
}

function validOptionalLabel(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string" && value.length > 0 && value.length <= 80 && /^[A-Za-z0-9._ -]+$/.test(value)
  );
}

function validStringArray(
  value: unknown,
  options: { maxItems: number; valid: (item: string) => boolean },
): value is string[] {
  return Array.isArray(value) && value.length <= options.maxItems &&
    value.every((item) => typeof item === "string" && options.valid(item)) &&
    new Set(value).size === value.length;
}

/** Fail closed on shape drift or any field outside the minimized packet contract. */
export function validateProviderReviewPacket(value: unknown): ValidationResult {
  if (!isRecord(value)) return { success: false, error: "packet_invalid:root" };
  const rootUnknown = unknownField(value, [
    "schemaVersion",
    "purpose",
    "organizationRef",
    "businessContext",
    "recommendation",
    "providerConnections",
    "requestedAdvisory",
  ]);
  if (rootUnknown) return { success: false, error: rootUnknown };
  if (JSON.stringify(value).length > PROVIDER_REVIEW_PACKET_MAX_BYTES) return { success: false, error: "packet_invalid:too_large" };
  if (value.schemaVersion !== PROVIDER_REVIEW_PACKET_VERSION) return { success: false, error: "packet_invalid:schemaVersion" };
  if (value.purpose !== "provider-suitability-advice") return { success: false, error: "packet_invalid:purpose" };
  if (!validIdentifier(value.organizationRef)) return { success: false, error: "packet_invalid:organizationRef" };

  const business = value.businessContext;
  if (!isRecord(business)) return { success: false, error: "packet_invalid:businessContext" };
  const businessUnknown = unknownField(business, ["archetypeId", "archetypeCategory", "jurisdictionBasis", "riskPosture"], "businessContext.");
  if (businessUnknown) return { success: false, error: businessUnknown };
  if (!validOptionalLabel(business.archetypeId) || !validOptionalLabel(business.archetypeCategory)) {
    return { success: false, error: "packet_invalid:archetype" };
  }
  if (!["conservative", "balanced", "progressive", null].includes(business.riskPosture as never)) {
    return { success: false, error: "packet_invalid:riskPosture" };
  }

  const jurisdictions = business.jurisdictionBasis;
  if (!isRecord(jurisdictions)) return { success: false, error: "packet_invalid:jurisdictionBasis" };
  const jurisdictionUnknown = unknownField(jurisdictions, ["operatesIn", "sellsTo", "employsIn", "dataResidency"], "businessContext.jurisdictionBasis.");
  if (jurisdictionUnknown) return { success: false, error: jurisdictionUnknown };
  for (const key of ["operatesIn", "sellsTo", "employsIn", "dataResidency"] as const) {
    if (!validStringArray(jurisdictions[key], { maxItems: 20, valid: (item) => /^[a-z0-9-]{1,32}$/.test(item) })) {
      return { success: false, error: `packet_invalid:${key}` };
    }
  }

  const recommendation = value.recommendation;
  if (!isRecord(recommendation)) return { success: false, error: "packet_invalid:recommendation" };
  const recommendationUnknown = unknownField(recommendation, ["status", "workloadClasses"], "recommendation.");
  if (recommendationUnknown) return { success: false, error: recommendationUnknown };
  if (!["ready", "review-needed", "not-ready"].includes(String(recommendation.status))) {
    return { success: false, error: "packet_invalid:status" };
  }
  if (!validStringArray(recommendation.workloadClasses, {
    maxItems: 20,
    valid: (item) => WORKLOAD_CLASSES.includes(item as AiWorkloadClassKey),
  })) return { success: false, error: "packet_invalid:workloadClasses" };

  if (!Array.isArray(value.providerConnections) || value.providerConnections.length > 50) {
    return { success: false, error: "packet_invalid:providerConnections" };
  }
  for (const [index, connection] of value.providerConnections.entries()) {
    if (!isRecord(connection)) return { success: false, error: `packet_invalid:providerConnections.${index}` };
    const connectionUnknown = unknownField(connection, ["providerConnectionId", "providerId", "scopes", "executionChannel", "accountClass"], `providerConnections.${index}.`);
    if (connectionUnknown) return { success: false, error: connectionUnknown };
    if (!validIdentifier(connection.providerConnectionId) || !validIdentifier(connection.providerId)) {
      return { success: false, error: `packet_invalid:providerConnections.${index}.id` };
    }
    if (!validIdentifier(connection.executionChannel, 40) || !validIdentifier(connection.accountClass, 40)) {
      return { success: false, error: `packet_invalid:providerConnections.${index}.posture` };
    }
    if (!validStringArray(connection.scopes, {
      maxItems: 3,
      valid: (item) => ["company-work", "public-only", "blocked"].includes(item),
    })) return { success: false, error: `packet_invalid:providerConnections.${index}.scopes` };
  }

  if (JSON.stringify(value.requestedAdvisory) !== JSON.stringify(REQUESTED_ADVISORY)) {
    return { success: false, error: "packet_invalid:requestedAdvisory" };
  }
  return { success: true, value: value as ProviderReviewPacket };
}

/** Build the bounded child objective consumed by AGT-902. */
export function formatProviderReviewObjective(packet: ProviderReviewPacket): string {
  const validation = validateProviderReviewPacket(packet);
  if (!validation.success) throw new Error(validation.error);
  const objective = [
    "Review this minimized provider-suitability packet. This consultation is advisory only.",
    "Return only one JSON object using schemaVersion provider-compliance-advisory.v1 with exactly these fields: schemaVersion, decision (recommended|conditional|not-suitable|insufficient-evidence), plainLanguageSummary, safestNextAction, workloadRestrictions (string array), unknowns (string array), humanReviewRequired (boolean), citations (one or more objects with title, reference, sourceClaimId, supports). reference must be a governed source key and sourceClaimId must be the exact canonical claim id supplied by the corpus. Do not wrap it in commentary.",
    "Use claim-level citations with source authority and applicability. State unknowns. Do not infer connected-account entitlements from provider marketing.",
    "do not change provider activation or routing eligibility. Do not request customer records, prompts, credentials, secrets, attachments, or raw regulated values.",
    JSON.stringify(validation.value),
  ].join("\n\n");
  if (objective.length >= PROVIDER_REVIEW_OBJECTIVE_MAX_BYTES) throw new Error("packet_invalid:objective_too_large");
  return objective;
}

/** Recover only the canonical packet appended by formatProviderReviewObjective. */
export function parseProviderReviewObjective(objective: string): ValidationResult {
  if (typeof objective !== "string" || objective.length === 0 || objective.length >= PROVIDER_REVIEW_OBJECTIVE_MAX_BYTES) {
    return { success: false, error: "packet_invalid:objective" };
  }
  const candidate = objective.split("\n\n").at(-1)?.trim();
  if (!candidate?.startsWith("{") || !candidate.endsWith("}")) {
    return { success: false, error: "packet_invalid:objective" };
  }
  try {
    return validateProviderReviewPacket(JSON.parse(candidate));
  } catch {
    return { success: false, error: "packet_invalid:objective" };
  }
}
