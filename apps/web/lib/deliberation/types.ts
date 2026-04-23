// Canonical runtime enums for the Deliberation Pattern Framework.
// Pure TypeScript source of truth — no Prisma, no DB, no runtime deps.
// Imported by MCP tool schemas, runtime validators, and UI badges.
// Multi-word values use hyphens, never underscores. Values must match
// byte-for-byte the arrays the schema.prisma column comments reference
// (spec §6.6) and the MCP tool enum arrays.

export const DELIBERATION_PATTERN_STATUSES = ["active", "deprecated", "draft"] as const;
export type DeliberationPatternStatus = (typeof DELIBERATION_PATTERN_STATUSES)[number];

export const DELIBERATION_ARTIFACT_TYPES = [
  "spec",
  "plan",
  "code-change",
  "architecture-decision",
  "policy",
  "research-question",
] as const;
export type DeliberationArtifactType = (typeof DELIBERATION_ARTIFACT_TYPES)[number];

export const DELIBERATION_TRIGGER_SOURCES = ["stage", "risk", "explicit", "combined"] as const;
export type DeliberationTriggerSource = (typeof DELIBERATION_TRIGGER_SOURCES)[number];

export const DELIBERATION_ADJUDICATION_MODES = [
  "synthesis",
  "majority-vote",
  "unanimous",
  "no-consensus-ok",
] as const;
export type DeliberationAdjudicationMode = (typeof DELIBERATION_ADJUDICATION_MODES)[number];

export const DELIBERATION_ACTIVATED_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type DeliberationActivatedRiskLevel = (typeof DELIBERATION_ACTIVATED_RISK_LEVELS)[number];

export const DELIBERATION_DIVERSITY_MODES = [
  "single-model-multi-persona",
  "multi-model-same-provider",
  "multi-provider-heterogeneous",
] as const;
export type DeliberationDiversityMode = (typeof DELIBERATION_DIVERSITY_MODES)[number];

export const DELIBERATION_STRATEGY_PROFILES = [
  "economy",
  "balanced",
  "high-assurance",
  "document-authority",
] as const;
export type DeliberationStrategyProfile = (typeof DELIBERATION_STRATEGY_PROFILES)[number];

export const DELIBERATION_CONSENSUS_STATES = [
  "consensus",
  "partial-consensus",
  "no-consensus",
  "insufficient-evidence",
  "pending",
] as const;
export type DeliberationConsensusState = (typeof DELIBERATION_CONSENSUS_STATES)[number];

export const DELIBERATION_EVIDENCE_STRICTNESS = ["lenient", "standard", "strict"] as const;
export type DeliberationEvidenceStrictness = (typeof DELIBERATION_EVIDENCE_STRICTNESS)[number];

export const CLAIM_TYPES = [
  "assertion",
  "objection",
  "rebuttal",
  "synthesis-fact",
  "synthesis-inference",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_STATUSES = ["supported", "contested", "unresolved", "rejected"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_EVIDENCE_GRADES = ["A", "B", "C", "D"] as const;
export type ClaimEvidenceGrade = (typeof CLAIM_EVIDENCE_GRADES)[number];

export const EVIDENCE_SOURCE_TYPES = [
  "code",
  "spec",
  "doc",
  "paper",
  "web",
  "db-query",
  "tool-output",
  "runtime-state",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

// Type-predicate guards. Each checks that `value` is a string in the
// canonical array. No trimming, no case-folding — canonical means exact.

export function isDeliberationPatternStatus(value: unknown): value is DeliberationPatternStatus {
  return (
    typeof value === "string" &&
    (DELIBERATION_PATTERN_STATUSES as readonly string[]).includes(value)
  );
}

export function isDeliberationArtifactType(value: unknown): value is DeliberationArtifactType {
  return (
    typeof value === "string" && (DELIBERATION_ARTIFACT_TYPES as readonly string[]).includes(value)
  );
}

export function isDeliberationTriggerSource(value: unknown): value is DeliberationTriggerSource {
  return (
    typeof value === "string" && (DELIBERATION_TRIGGER_SOURCES as readonly string[]).includes(value)
  );
}

export function isDeliberationAdjudicationMode(
  value: unknown,
): value is DeliberationAdjudicationMode {
  return (
    typeof value === "string" &&
    (DELIBERATION_ADJUDICATION_MODES as readonly string[]).includes(value)
  );
}

export function isDeliberationActivatedRiskLevel(
  value: unknown,
): value is DeliberationActivatedRiskLevel {
  return (
    typeof value === "string" &&
    (DELIBERATION_ACTIVATED_RISK_LEVELS as readonly string[]).includes(value)
  );
}

export function isDeliberationDiversityMode(value: unknown): value is DeliberationDiversityMode {
  return (
    typeof value === "string" && (DELIBERATION_DIVERSITY_MODES as readonly string[]).includes(value)
  );
}

export function isDeliberationStrategyProfile(
  value: unknown,
): value is DeliberationStrategyProfile {
  return (
    typeof value === "string" &&
    (DELIBERATION_STRATEGY_PROFILES as readonly string[]).includes(value)
  );
}

export function isDeliberationConsensusState(value: unknown): value is DeliberationConsensusState {
  return (
    typeof value === "string" && (DELIBERATION_CONSENSUS_STATES as readonly string[]).includes(value)
  );
}

export function isDeliberationEvidenceStrictness(
  value: unknown,
): value is DeliberationEvidenceStrictness {
  return (
    typeof value === "string" &&
    (DELIBERATION_EVIDENCE_STRICTNESS as readonly string[]).includes(value)
  );
}

export function isClaimType(value: unknown): value is ClaimType {
  return typeof value === "string" && (CLAIM_TYPES as readonly string[]).includes(value);
}

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === "string" && (CLAIM_STATUSES as readonly string[]).includes(value);
}

export function isClaimEvidenceGrade(value: unknown): value is ClaimEvidenceGrade {
  return typeof value === "string" && (CLAIM_EVIDENCE_GRADES as readonly string[]).includes(value);
}

export function isEvidenceSourceType(value: unknown): value is EvidenceSourceType {
  return typeof value === "string" && (EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value);
}
