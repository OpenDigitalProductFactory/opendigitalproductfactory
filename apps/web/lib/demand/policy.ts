// Pure demand-policy resolver — no server imports. Safe in tests and client
// components. EP-DEMAND-MGMT Phase 4.
//
// The scoring policy (active framework + org-wide default investment-bucket
// targets) is operator-owned config, not a hardcoded default. This resolves the
// persisted config into typed, defaulted values the engine and board read.
// Spec: docs/superpowers/specs/2026-07-10-demand-management-design.md §11.

import { DEMAND_SCORE_FRAMEWORKS, type DemandScoreFramework, type InvestmentBucket } from "../explore/backlog";
import { DEFAULT_BUCKET_TARGETS } from "./buckets";

export const DEFAULT_DEMAND_FRAMEWORK: DemandScoreFramework = "rice";

export type DemandPolicy = {
  framework: DemandScoreFramework;
  bucketTargets: Record<InvestmentBucket, number>;
};

export type DemandPolicyConfig = {
  demandFramework?: string | null;
  demandBucketTargets?: unknown;
};

function coerceFramework(value: string | null | undefined): DemandScoreFramework {
  return (DEMAND_SCORE_FRAMEWORKS as readonly string[]).includes(value ?? "")
    ? (value as DemandScoreFramework)
    : DEFAULT_DEMAND_FRAMEWORK;
}

/**
 * Coerce a stored JSON targets object into a complete, numeric bucket-target
 * map, falling back to the default split for any missing/invalid entry.
 */
function coerceTargets(raw: unknown): Record<InvestmentBucket, number> {
  const out: Record<InvestmentBucket, number> = { ...DEFAULT_BUCKET_TARGETS };
  if (raw && typeof raw === "object") {
    for (const bucket of ["run", "grow", "transform"] as const) {
      const v = (raw as Record<string, unknown>)[bucket];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[bucket] = v;
    }
  }
  return out;
}

/** Resolve the persisted config (or null) into a complete, typed policy. */
export function resolveDemandPolicy(config: DemandPolicyConfig | null | undefined): DemandPolicy {
  return {
    framework: coerceFramework(config?.demandFramework),
    bucketTargets: coerceTargets(config?.demandBucketTargets),
  };
}
