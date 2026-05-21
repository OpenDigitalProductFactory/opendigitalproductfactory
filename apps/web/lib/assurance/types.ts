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
] as const;

export type AssuranceFindingKind = (typeof ASSURANCE_FINDING_KINDS)[number];

export const ASSURANCE_AFFECTED_TYPES = [
  "source-file",
  "bom-component",
  "inventory-entity",
  "build-artifact-revision",
  "release-bundle",
] as const;

export type AssuranceAffectedType = (typeof ASSURANCE_AFFECTED_TYPES)[number];

export const ASSURANCE_POLICY_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type AssurancePolicySeverity = (typeof ASSURANCE_POLICY_SEVERITIES)[number];

export const ASSURANCE_RELEASE_IMPACTS = ["block", "warn", "track", "none"] as const;
export type AssuranceReleaseImpact = (typeof ASSURANCE_RELEASE_IMPACTS)[number];

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
