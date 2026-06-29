import {
  regulationApplies,
  type RegionProfile,
} from "@dpf/db/regulation-applicability";
import type { ProfessionJurisdictionBasis } from "@dpf/db/wiki-taxonomy";

import {
  AUTONOMY_LEVELS,
  minLevel,
  type AutonomyLevel,
} from "./trust-graduation";

const DEFAULT_REQUIRED_EVIDENCE = "operator-policy-review";

export type RegulatoryAutonomyPolicyStatus = "draft" | "active" | "retired";

export type RegulatoryAutonomyPolicyRecord = {
  policyId: string;
  policyKey?: string | null;
  version?: number | null;
  status: RegulatoryAutonomyPolicyStatus | string;
  industry?: string | null;
  jurisdiction: string;
  jurisdictionBasis: ProfessionJurisdictionBasis;
  activityClass: string;
  maxAutonomyLevel: AutonomyLevel | string;
  humanControlRequired?: boolean | null;
  requiredEvidence?: unknown;
  effectiveFrom?: Date | string | null;
  effectiveUntil?: Date | string | null;
};

export type RegulatoryAutonomyCeilingResolution = {
  ceiling: AutonomyLevel;
  defaulted: boolean;
  humanControlRequired: boolean;
  requiredEvidence: string[];
  matchedPolicies: RegulatoryAutonomyPolicyRecord[];
  matchedBasis: ProfessionJurisdictionBasis[];
  reason: string;
};

export type ResolveRegulatoryAutonomyCeilingInput = {
  policies: readonly RegulatoryAutonomyPolicyRecord[];
  profile: RegionProfile;
  industry?: string | null;
  activityClass: string;
  asOf?: Date | string | null;
};

export function resolveRegulatoryAutonomyCeiling(
  input: ResolveRegulatoryAutonomyCeilingInput,
): RegulatoryAutonomyCeilingResolution {
  const asOf = toDate(input.asOf) ?? new Date();
  const matches: Array<{
    policy: RegulatoryAutonomyPolicyRecord;
    ceiling: AutonomyLevel;
    invalidCeiling: boolean;
    matchedBasis: ProfessionJurisdictionBasis[];
  }> = [];

  for (const policy of input.policies) {
    if (!isActiveAt(policy, asOf)) continue;
    if (!matchesActivity(policy.activityClass, input.activityClass)) continue;
    if (!matchesIndustry(policy.industry, input.industry)) continue;

    const applicability = regulationApplies(
      {
        basis: [policy.jurisdictionBasis],
        jurisdictions: policy.jurisdictionBasis === "global" ? [] : [policy.jurisdiction],
      },
      input.profile,
    );
    if (!applicability.applies) continue;
    const ceiling = coerceAutonomyLevel(policy.maxAutonomyLevel);
    matches.push({
      policy,
      ceiling: ceiling.value,
      invalidCeiling: ceiling.invalid,
      matchedBasis: applicability.matchedBasis,
    });
  }

  if (matches.length === 0) {
    return {
      ceiling: "propose",
      defaulted: true,
      humanControlRequired: true,
      requiredEvidence: [DEFAULT_REQUIRED_EVIDENCE],
      matchedPolicies: [],
      matchedBasis: [],
      reason:
        "No active regulatory autonomy policy matched this industry, jurisdiction, and activity class; defaulting to propose until an operator/compliance policy review sets the ceiling.",
    };
  }

  const ceiling = matches.reduce<AutonomyLevel>(
    (acc, match) => minLevel(acc, match.ceiling),
    "autopilot",
  );
  const humanControlRequired = matches.some(
    (match) => match.invalidCeiling || match.policy.humanControlRequired === true,
  );
  const requiredEvidence = dedupe(
    matches.flatMap((match) => [
      ...evidenceKeys(match.policy.requiredEvidence),
      ...(match.invalidCeiling ? [DEFAULT_REQUIRED_EVIDENCE] : []),
    ]),
  );
  const matchedBasis = dedupe(matches.flatMap((match) => match.matchedBasis));

  return {
    ceiling,
    defaulted: false,
    humanControlRequired,
    requiredEvidence,
    matchedPolicies: matches.map((match) => match.policy),
    matchedBasis,
    reason: `Regulatory autonomy ceiling ${ceiling} from ${matches.length} active matching policy row${matches.length === 1 ? "" : "s"}.`,
  };
}

function isActiveAt(policy: RegulatoryAutonomyPolicyRecord, asOf: Date): boolean {
  if (policy.status !== "active") return false;
  const effectiveFrom = toDate(policy.effectiveFrom);
  const effectiveUntil = toDate(policy.effectiveUntil);
  if (effectiveFrom && effectiveFrom > asOf) return false;
  return !(effectiveUntil && effectiveUntil <= asOf);
}

function matchesActivity(policyActivityClass: string, activityClass: string): boolean {
  const policyValue = normalize(policyActivityClass);
  return policyValue === "*" || policyValue === "global" || policyValue === normalize(activityClass);
}

function matchesIndustry(policyIndustry: string | null | undefined, industry: string | null | undefined): boolean {
  const policyValue = normalize(policyIndustry);
  if (!policyValue || policyValue === "*" || policyValue === "global") return true;
  return policyValue === normalize(industry);
}

function evidenceKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function coerceAutonomyLevel(value: string): { value: AutonomyLevel; invalid: boolean } {
  if (isAutonomyLevel(value)) return { value, invalid: false };
  return { value: "propose", invalid: true };
}

function dedupe<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function isAutonomyLevel(value: string): value is AutonomyLevel {
  return AUTONOMY_LEVELS.includes(value as AutonomyLevel);
}
