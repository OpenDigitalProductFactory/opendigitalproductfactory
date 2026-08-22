export const ASSURANCE_FINDING_KINDS = [
  "vulnerability",
  "license",
  "malicious-package",
  "policy-violation",
  "provenance",
  "configuration-drift",
  "missing-patch",
  "unsupported-component",
  "maintainer-risk",
  // EP-COWORKER-LIFECYCLE Phase 2: a coworker failed a certification oracle
  // (no tool call, fabrication, false refusal, empty tool surface).
  "coworker-certification",
  // TAK §8.11 obligation assurance watch: a recorded obligation, control
  // review, or licence expiry has entered the look-ahead window — or declares a
  // recurrence with no next date, which is a control that reads as in force and
  // is not (§8.11.1, dead-intent rule).
  "obligation-deadline",
] as const;

export type AssuranceFindingKind = (typeof ASSURANCE_FINDING_KINDS)[number];

export const ASSURANCE_AFFECTED_TYPES = [
  "source-file",
  "bom-component",
  "inventory-entity",
  "build-artifact-revision",
  "release-bundle",
  // EP-COWORKER-LIFECYCLE Phase 2: certification findings target a coworker.
  "agent",
  // The obligation assurance watch targets a compliance record: an Obligation,
  // a Control, or a LicenseRequirementReference.
  "compliance-record",
] as const;

export type AssuranceAffectedType = (typeof ASSURANCE_AFFECTED_TYPES)[number];

export const ASSURANCE_POLICY_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type AssurancePolicySeverity = (typeof ASSURANCE_POLICY_SEVERITIES)[number];

export const ASSURANCE_RELEASE_IMPACTS = ["block", "warn", "track", "none"] as const;
export type AssuranceReleaseImpact = (typeof ASSURANCE_RELEASE_IMPACTS)[number];

export const ASSURANCE_FINDING_STATUSES = [
  "open",
  "accepted",
  "planned",
  "blocked",
  "resolved",
  "false-positive",
  "deferred",
] as const;
export type AssuranceFindingStatus = (typeof ASSURANCE_FINDING_STATUSES)[number];

export const ASSURANCE_REACHABILITY = ["reachable", "not-reachable", "unknown"] as const;
export type AssuranceReachability = (typeof ASSURANCE_REACHABILITY)[number];

export const ASSURANCE_EXPOSURE = ["external", "internal", "lab", "unknown"] as const;
export type AssuranceExposure = (typeof ASSURANCE_EXPOSURE)[number];

export type FindingIdentifierStability = "strong" | "weak";

export interface FindingKeyInput {
  adapterKey: string;
  findingKind: AssuranceFindingKind;
  affectedType: AssuranceAffectedType;
  affectedId: string;
  vendorIdentifier: string;
}

export interface NormalizedAssuranceFinding extends FindingKeyInput {
  findingKey: string;
  title: string;
  description?: string;
  sourceSeverity?: string;
  policySeverity: AssurancePolicySeverity;
  releaseImpact: AssuranceReleaseImpact;
  reachability: AssuranceReachability;
  exposure: AssuranceExposure;
  identifierStability: FindingIdentifierStability;
  evidence: Record<string, unknown>;
  remediationHint: Record<string, unknown>;
}
