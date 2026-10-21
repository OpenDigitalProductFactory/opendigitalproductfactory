// Owner-scoped planning targets. Pure contract shared by UI, MCP and dispatch.
// Callers must establish funding authority before supplying owner kind/purpose.
import { resolveDevelopmentInvestmentTarget } from "../platform-dev-policy";
import { isRecord } from "../shared/coerce";
import type { InvestmentWorkClass } from "@dpf/db";

export type InvestmentClass = InvestmentWorkClass;
export type InvestmentPurpose = "shared-platform" | "archetype";
export type InvestmentOwnerKind = "founder" | "organization";

export type BalancePolicy = {
  refactorPercent: number;
  windowDays: number;
  tolerancePercent: number;
  steeringEnabled: boolean;
  minimumAttempts: number;
  minimumTokens: number;
  minimumClassificationPercent: number;
  freshnessDays: number;
};

export function defaultBalancePolicy(budgetOwner: InvestmentOwnerKind, workPurpose: InvestmentPurpose): BalancePolicy {
  return {
    refactorPercent: resolveDevelopmentInvestmentTarget({ budgetOwner, workPurpose })!.refactorPercent,
    windowDays: 42, tolerancePercent: 5, steeringEnabled: false,
    minimumAttempts: 20, minimumTokens: 10_000, minimumClassificationPercent: 80, freshnessDays: 7,
  };
}

export function validateBalancePolicy(value: unknown): value is BalancePolicy {
  if (!isRecord(value)) return false;
  const bounded = (key: string, min: number, max: number) =>
    typeof value[key] === "number" && Number.isInteger(value[key]) && value[key] >= min && value[key] <= max;
  return bounded("refactorPercent", 0, 100) && bounded("windowDays", 1, 180)
    && bounded("tolerancePercent", 0, 20) && typeof value.steeringEnabled === "boolean"
    && bounded("minimumAttempts", 1, 1_000_000) && bounded("minimumTokens", 1, Number.MAX_SAFE_INTEGER)
    && bounded("minimumClassificationPercent", 1, 100) && bounded("freshnessDays", 1, value.windowDays as number);
}

/** Only unambiguous repair/new work defaults. Profession judgment may explicitly classify other work. */
export function classifyInvestment(workType: string | null | undefined): InvestmentClass | null {
  if (workType === "bug" || workType === "refactor") return "refactor";
  if (workType === "feature") return "new";
  return null;
}

export function formatInvestmentGuidance(input: { ownerKind: InvestmentOwnerKind; scope: { purpose: InvestmentPurpose }; policy: BalancePolicy; source: "default" | "explicit" }): string {
  return `Funding scope: ${input.ownerKind}, ${input.scope.purpose}. ${input.source === "default" ? "Default" : "Owner-set"} cumulative planning target: ${input.policy.refactorPercent}% refactoring/repair and ${100 - input.policy.refactorPercent}% new capability over ${input.policy.windowDays} days. Bug fixes normally count as refactoring. This is approximate over time, never a per-task token quota. WWMD steers platform decisions, WWWD organization decisions, and WSID craft and obligations. Mandatory repair, readiness, authority, WIP and spend limits still apply. External inference outside the measured pipeline is unobserved.`;
}

export type BalanceObservation = {
  knownAttempts: number;
  unknownAttempts: number;
  refactorTokens: number;
  newTokens: number;
  unclassifiedTokens: number;
  latestAt: string | null;
};
export type BalanceSuppression = "invalid-policy" | "invalid-observation" | "not-enabled" | "insufficient-attempts"
  | "insufficient-tokens" | "insufficient-classification" | "insufficient-coverage" | "stale";
export type BalanceEvaluation = BalanceObservation & {
  knownTokens: number;
  actualRefactorPercent: number | null;
  classificationPercent: number | null;
  preferred: InvestmentClass | null;
  suppression: BalanceSuppression | null;
};

/** Never estimates absent tokens or assigns installation-wide unknown owners to this scope. */
export function evaluateInvestmentBalance(policy: BalancePolicy, observation: BalanceObservation, now = new Date()): BalanceEvaluation {
  const classified = observation.refactorTokens + observation.newTokens;
  const knownTokens = classified + observation.unclassifiedTokens;
  const actualRefactorPercent = classified > 0 ? observation.refactorTokens / classified * 100 : null;
  const classificationPercent = knownTokens > 0 ? classified / knownTokens * 100 : null;
  const result: BalanceEvaluation = { ...observation, knownTokens, actualRefactorPercent, classificationPercent, preferred: null, suppression: null };
  const suppress = (reason: BalanceSuppression) => ({ ...result, suppression: reason });
  if (!validateBalancePolicy(policy)) return suppress("invalid-policy");
  if (![observation.knownAttempts, observation.unknownAttempts, observation.refactorTokens, observation.newTokens, observation.unclassifiedTokens, knownTokens, observation.knownAttempts + observation.unknownAttempts]
    .every((value) => Number.isSafeInteger(value) && value >= 0) || !Number.isFinite(now.getTime())) return suppress("invalid-observation");
  if (!policy.steeringEnabled) return suppress("not-enabled");
  if (observation.knownAttempts < policy.minimumAttempts) return suppress("insufficient-attempts");
  if (observation.knownAttempts / (observation.knownAttempts + observation.unknownAttempts) * 100 < policy.minimumClassificationPercent) return suppress("insufficient-coverage");
  if (knownTokens < policy.minimumTokens) return suppress("insufficient-tokens");
  if (classificationPercent === null || classificationPercent < policy.minimumClassificationPercent) return suppress("insufficient-classification");
  const latest = observation.latestAt === null ? NaN : Date.parse(observation.latestAt);
  const age = now.getTime() - latest;
  if (!Number.isFinite(age) || age < 0 || age > policy.freshnessDays * 86_400_000) return suppress("stale");
  if (actualRefactorPercent !== null && actualRefactorPercent < policy.refactorPercent - policy.tolerancePercent) result.preferred = "refactor";
  else if (actualRefactorPercent !== null && actualRefactorPercent > policy.refactorPercent + policy.tolerancePercent) result.preferred = "new";
  return result;
}
