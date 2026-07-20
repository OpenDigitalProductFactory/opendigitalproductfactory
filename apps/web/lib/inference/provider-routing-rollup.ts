// apps/web/lib/inference/provider-routing-rollup.ts
//
// BI-1B46967D — Pure rollup of a provider's `ModelProfile` rows into the display
// summary used by the Providers grid (/platform/ai/providers).
//
// The grid historically rendered `ModelProvider.{reasoning,codegen,toolFidelity}`,
// which the 2026-03-19 model-level-routing-profiles design declares DEAD COLUMNS:
// they are frozen at the seed default (50) and ignored by the routing pipeline,
// which reads the per-model `ModelProfile` instead. That made every provider read
// as an uncalibrated 50/50/50 even though routing was well calibrated. This helper
// rolls the calibrated per-model truth back up to the provider row, and reports
// freshness so a genuinely-unmeasured provider reads "not measured" rather than a
// misleading 50.
//
// Kept dependency-free of Prisma so it is unit-testable in isolation.
import { assignTierFromModelId, type QualityTier } from "@/lib/routing/quality-tiers";
import type { ProviderModelSummary } from "./ai-provider-types";

/** Minimal `ModelProfile` shape needed to roll a provider's models into a grid summary. */
export type ProfileForRollup = {
  modelId: string;
  modelClass: string;
  modelStatus: string;
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  evalCount: number;
  lastEvalAt: Date | null;
  profileSource: string;
};

/**
 * Classes that drive the D25 "strongest tier" + non-chat-badge split (preserved
 * from the original behavior).
 */
const CHATLIKE_CLASSES = new Set(["chat", "reasoning"]);

/**
 * Classes eligible to stand in as the provider's routing representative — the
 * models that actually receive coworker/build work. Includes `code` so a coding
 * provider (e.g. codex, with `modelClass="code"` models) surfaces its calibrated
 * codegen capability instead of falsely reading "not measured".
 */
const ROUTING_REP_CLASSES = new Set(["chat", "reasoning", "code"]);

// D25: tier ordering for the "strongest among discovered" reduction.
const TIER_RANK: Record<QualityTier, number> = {
  frontier: 4,
  strong: 3,
  adequate: 2,
  basic: 1,
};

/**
 * A model carries real (non-seed) capability provenance: a curated catalog
 * baseline, a DPF evaluation, or production-observed scores — anything but the
 * bootstrap seed default. Only such a model may stand in for the provider's
 * routing capability; a seed row is a placeholder, not a measurement.
 */
function isMeasured(p: ProfileForRollup): boolean {
  return p.profileSource !== "seed";
}

/** A DPF evaluation has actually run against this model (the freshness anchor). */
function hasEvalEvidence(p: ProfileForRollup): boolean {
  return p.lastEvalAt != null || p.evalCount > 0;
}

function composite(p: ProfileForRollup): number {
  return p.reasoning + p.codegen + p.toolFidelity;
}

/**
 * `b` should replace the current representative `a`. Strongest composite wins;
 * ties break toward the model with eval evidence, then the higher eval count.
 */
function beats(b: ProfileForRollup, a: ProfileForRollup): boolean {
  const cb = composite(b);
  const ca = composite(a);
  if (cb !== ca) return cb > ca;
  if (hasEvalEvidence(b) !== hasEvalEvidence(a)) return hasEvalEvidence(b);
  return b.evalCount > a.evalCount;
}

/**
 * Roll a provider's `ModelProfile` rows into the grid summary.
 *
 * `routingScores` is non-null only when the provider has at least one ACTIVE,
 * chat/reasoning, non-seed (measured) model — its strongest such model is the
 * representative. A provider whose chat models are all seed placeholders rolls up
 * to `routingScores=null` so the UI reads "not measured" instead of a fake 50.
 */
export function rollUpProviderModels(profiles: ProfileForRollup[]): ProviderModelSummary {
  let activeModels = 0;
  let measuredModels = 0;
  let evaluatedModels = 0;
  const nonChatClasses: string[] = [];
  let derivedTier: QualityTier | null = null;
  let lastEvalAt: Date | null = null;
  let rep: ProfileForRollup | null = null;

  for (const p of profiles) {
    if (p.modelStatus === "active") activeModels++;
    if (isMeasured(p)) measuredModels++;
    if (p.lastEvalAt != null) {
      evaluatedModels++;
      if (lastEvalAt === null || p.lastEvalAt.getTime() > lastEvalAt.getTime()) {
        lastEvalAt = p.lastEvalAt;
      }
    }

    if (CHATLIKE_CLASSES.has(p.modelClass)) {
      // D25: derive tier from the model id family rather than trust seed data.
      const t = assignTierFromModelId(p.modelId);
      if (derivedTier === null || TIER_RANK[t] > TIER_RANK[derivedTier]) derivedTier = t;
    } else if (!nonChatClasses.includes(p.modelClass)) {
      nonChatClasses.push(p.modelClass);
    }

    // Representative = strongest ACTIVE, routing-capable (chat/reasoning/code),
    // measured (non-seed) model.
    if (
      ROUTING_REP_CLASSES.has(p.modelClass) &&
      p.modelStatus === "active" &&
      isMeasured(p) &&
      (rep === null || beats(p, rep))
    ) {
      rep = p;
    }
  }

  return {
    totalModels: profiles.length,
    activeModels,
    nonChatClasses,
    derivedTier,
    routingScores: rep
      ? { reasoning: rep.reasoning, codegen: rep.codegen, toolFidelity: rep.toolFidelity }
      : null,
    representativeModelId: rep?.modelId ?? null,
    measuredModels,
    evaluatedModels,
    lastEvalAt: lastEvalAt ? lastEvalAt.toISOString() : null,
  };
}

export type ProviderRoutingTelemetrySample = {
  providerId: string;
  modelId: string;
  activityClass: string;
  workloadClasses: readonly string[];
  outcome: "selected" | "success" | "failure" | "excluded";
};

export type ProviderRoutingTelemetryRollup = {
  totalRequests: number;
  selectedRoutes: number;
  successes: number;
  failures: number;
  exclusions: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  byActivityClass: Record<string, number>;
  byWorkloadClass: Record<string, { requests: number; successes: number; failures: number }>;
  suppressedWorkloadClasses: string[];
  minimumCohortSize: number;
};

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

/**
 * Operational routing totals remain complete at provider/model level. Workload
 * cohorts are only emitted once they meet the privacy floor, preventing rare
 * regulated activity classes from becoming a person- or customer-level signal.
 */
export function rollUpProviderRoutingTelemetry(
  samples: ReadonlyArray<ProviderRoutingTelemetrySample>,
  options: { minimumCohortSize?: number } = {},
): ProviderRoutingTelemetryRollup {
  const minimumCohortSize = Math.max(3, Math.floor(options.minimumCohortSize ?? 5));
  const byProvider: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byActivityClass: Record<string, number> = {};
  const workload = new Map<string, { requests: number; successes: number; failures: number }>();
  let successes = 0;
  let selectedRoutes = 0;
  let failures = 0;
  let exclusions = 0;

  for (const sample of samples) {
    increment(byProvider, sample.providerId);
    increment(byModel, `${sample.providerId}/${sample.modelId}`);
    increment(byActivityClass, sample.activityClass);
    if (sample.outcome === "selected") selectedRoutes += 1;
    else if (sample.outcome === "success") successes += 1;
    else if (sample.outcome === "failure") failures += 1;
    else exclusions += 1;
    for (const workloadClass of new Set(sample.workloadClasses)) {
      const current = workload.get(workloadClass) ?? { requests: 0, successes: 0, failures: 0 };
      current.requests += 1;
      if (sample.outcome === "success") current.successes += 1;
      if (sample.outcome === "failure") current.failures += 1;
      workload.set(workloadClass, current);
    }
  }

  const byWorkloadClass: ProviderRoutingTelemetryRollup["byWorkloadClass"] = {};
  const suppressedWorkloadClasses: string[] = [];
  for (const [workloadClass, counts] of [...workload.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (counts.requests < minimumCohortSize) suppressedWorkloadClasses.push(workloadClass);
    else byWorkloadClass[workloadClass] = counts;
  }
  return {
    totalRequests: samples.length,
    selectedRoutes,
    successes,
    failures,
    exclusions,
    byProvider: Object.fromEntries(Object.entries(byProvider).sort()),
    byModel: Object.fromEntries(Object.entries(byModel).sort()),
    byActivityClass: Object.fromEntries(Object.entries(byActivityClass).sort()),
    byWorkloadClass,
    suppressedWorkloadClasses,
    minimumCohortSize,
  };
}
