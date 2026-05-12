import type { CapacityContinuityCandidate } from "./candidates";

export type CapacityProviderClass =
  | "fixed-cost"
  | "quota"
  | "token-priced"
  | "local";

export type CapacityModelTierHint = "routine" | "standard" | "frontier";

export type CapacityProviderFinanceSignal = {
  providerId: string;
  providerClass: CapacityProviderClass;
  status?: "active" | "degraded" | "inactive";
  utilizationPct?: number | null;
  projectedUnusedValue?: number | null;
  overageRisk?: boolean;
};

export type CapacityRoutingHints = {
  budgetClass: "minimize_cost" | "balanced" | "quality_first";
  interactionMode: "background";
  modelTierHint: CapacityModelTierHint;
  preferredProviderClass?: CapacityProviderClass;
  avoidProviderClasses?: CapacityProviderClass[];
  reasonCodes: string[];
};

export type CapacityFinanceTracking = {
  candidateId: string;
  dedupeKey: string;
  observedProviderClasses: CapacityProviderClass[];
  sourceProviderIds: string[];
  projectedUnusedValue: number;
  utilizationPct: number | null;
};

export type CapacityFinanceRoutingPlan = {
  routingHints: CapacityRoutingHints;
  financeTracking: CapacityFinanceTracking;
};

type CapacityFinanceRoutingOptions = {
  financeSignals: CapacityProviderFinanceSignal[];
};

export function planCapacityFinanceRouting(
  candidate: CapacityContinuityCandidate,
  options: CapacityFinanceRoutingOptions,
): CapacityFinanceRoutingPlan {
  const usableSignals = options.financeSignals.filter((signal) =>
    signal.status === undefined || signal.status === "active" || signal.status === "degraded"
  );
  const preferredSignal = choosePreferredSignal(usableSignals);
  const modelTierHint = normalizeModelTier(candidate.capacityFit.modelTierHint);
  const reasonCodes = buildReasonCodes(candidate, modelTierHint, preferredSignal, usableSignals);
  const avoidProviderClasses = buildAvoidProviderClasses(usableSignals);

  return {
    routingHints: {
      budgetClass: budgetClassFor(modelTierHint, preferredSignal, avoidProviderClasses),
      interactionMode: "background",
      modelTierHint,
      ...(preferredSignal ? { preferredProviderClass: preferredSignal.providerClass } : {}),
      ...(avoidProviderClasses.length > 0 ? { avoidProviderClasses } : {}),
      reasonCodes,
    },
    financeTracking: {
      candidateId: candidate.candidateId,
      dedupeKey: candidate.dedupeKey,
      observedProviderClasses: unique(usableSignals.map((signal) => signal.providerClass)),
      sourceProviderIds: usableSignals.map((signal) => signal.providerId),
      projectedUnusedValue: sumProjectedUnusedValue(usableSignals),
      utilizationPct: averageUtilization(usableSignals),
    },
  };
}

function choosePreferredSignal(signals: CapacityProviderFinanceSignal[]) {
  const underusedFixed = signals.find((signal) =>
    (signal.providerClass === "fixed-cost" || signal.providerClass === "quota" || signal.providerClass === "local") &&
    !signal.overageRisk &&
    Number(signal.projectedUnusedValue ?? 0) > 0
  );

  return underusedFixed ?? signals.find((signal) => signal.providerClass === "local" && !signal.overageRisk);
}

function normalizeModelTier(input: string | undefined): CapacityModelTierHint {
  if (input === "routine" || input === "standard" || input === "frontier") {
    return input;
  }

  return "standard";
}

function budgetClassFor(
  modelTierHint: CapacityModelTierHint,
  preferredSignal: CapacityProviderFinanceSignal | undefined,
  avoidProviderClasses: CapacityProviderClass[],
): CapacityRoutingHints["budgetClass"] {
  if (modelTierHint === "frontier") {
    return "quality_first";
  }

  if (preferredSignal || avoidProviderClasses.includes("token-priced")) {
    return "minimize_cost";
  }

  return modelTierHint === "routine" ? "minimize_cost" : "balanced";
}

function buildReasonCodes(
  candidate: CapacityContinuityCandidate,
  modelTierHint: CapacityModelTierHint,
  preferredSignal: CapacityProviderFinanceSignal | undefined,
  signals: CapacityProviderFinanceSignal[],
) {
  const reasonCodes: string[] = [];

  if (preferredSignal && Number(preferredSignal.projectedUnusedValue ?? 0) > 0) {
    reasonCodes.push("underused_commitment");
  }

  if (signals.some((signal) => signal.overageRisk)) {
    reasonCodes.push("overage_risk");
  }

  if (modelTierHint === "frontier") {
    reasonCodes.push("frontier_required");
  }

  if (candidate.riskClass === "read-only" || candidate.riskClass === "review-after") {
    reasonCodes.push("safe_background_work");
  }

  return unique(reasonCodes);
}

function buildAvoidProviderClasses(signals: CapacityProviderFinanceSignal[]) {
  const avoid = signals
    .filter((signal) => signal.providerClass === "token-priced" && signal.overageRisk)
    .map((signal) => signal.providerClass);

  return unique(avoid);
}

function sumProjectedUnusedValue(signals: CapacityProviderFinanceSignal[]) {
  return signals.reduce((sum, signal) => sum + Number(signal.projectedUnusedValue ?? 0), 0);
}

function averageUtilization(signals: CapacityProviderFinanceSignal[]) {
  const values = signals
    .map((signal) => signal.utilizationPct)
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return null;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}
