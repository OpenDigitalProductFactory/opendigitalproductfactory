export const COWORKER_SERVICE_STATUSES = ["draft", "active", "retired"] as const;
export type CoworkerServiceStatus = (typeof COWORKER_SERVICE_STATUSES)[number];

export const COWORKER_ENGAGEMENT_STATUSES = [
  "requested",
  "needs-approval",
  "accepted",
  "rejected",
  "in-progress",
  "completed",
  "cancelled",
] as const;
export type CoworkerEngagementStatus = (typeof COWORKER_ENGAGEMENT_STATUSES)[number];

export const COWORKER_CATALOG_RISK_TIERS = ["low", "medium", "high", "critical"] as const;
export type CoworkerCatalogRiskTier = (typeof COWORKER_CATALOG_RISK_TIERS)[number];

export const COWORKER_AUTHORITY_BOUNDARIES = [
  "advice-only",
  "proposal-only",
  "approval-required",
  "autonomous-allowed",
  "never-allowed",
] as const;
export type CoworkerAuthorityBoundary = (typeof COWORKER_AUTHORITY_BOUNDARIES)[number];

export const COWORKER_AVAILABILITY_SCOPES = ["internal", "external", "partner"] as const;
export type CoworkerAvailabilityScope = (typeof COWORKER_AVAILABILITY_SCOPES)[number];

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function isCoworkerServiceStatus(value: unknown): value is CoworkerServiceStatus {
  return isOneOf(COWORKER_SERVICE_STATUSES, value);
}

export function isCoworkerEngagementStatus(value: unknown): value is CoworkerEngagementStatus {
  return isOneOf(COWORKER_ENGAGEMENT_STATUSES, value);
}

export function isCoworkerCatalogRiskTier(value: unknown): value is CoworkerCatalogRiskTier {
  return isOneOf(COWORKER_CATALOG_RISK_TIERS, value);
}

export function isCoworkerAuthorityBoundary(value: unknown): value is CoworkerAuthorityBoundary {
  return isOneOf(COWORKER_AUTHORITY_BOUNDARIES, value);
}

export function isCoworkerAvailabilityScope(value: unknown): value is CoworkerAvailabilityScope {
  return isOneOf(COWORKER_AVAILABILITY_SCOPES, value);
}

