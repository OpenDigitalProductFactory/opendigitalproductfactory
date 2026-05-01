import {
  evaluateFingerprintRule,
  type FingerprintMatchExpression,
  type FingerprintRuleObservation,
} from "./discovery-fingerprint-rules";

/** Tightened view of `DiscoveryFingerprintRule` for adapter consumption. */
export interface AdapterRule {
  id: string;
  ruleKey: string;
  status: string; // "draft" | "active" | "deprecated" — only "active" is honored
  matchExpression: FingerprintMatchExpression;
  requiredEvidenceFamilies: string[];
  taxonomyNodeId: string | null;
  identityConfidence: number;
  taxonomyConfidence: number;
  resolvedIdentity: {
    manufacturer?: string;
    productModel?: string;
    technicalClass?: string;
    iconKey?: string;
  };
}

export interface AdapterMatch {
  ruleId: string;
  ruleKey: string;
  taxonomyNodeId: string | null;
  identityConfidence: number;
  taxonomyConfidence: number;
  combinedConfidence: number;
  manufacturer?: string;
  productModel?: string;
  technicalClass?: string;
  iconKey?: string;
}

/**
 * Interpretation layer over `evaluateFingerprintRule`.
 *
 * 1. Filters rules to `status === "active"`.
 * 2. Evaluates each remaining rule against the observation.
 * 3. Of the rules that match, returns the one with the highest combined
 *    confidence (`identityConfidence + taxonomyConfidence`). Stable tiebreak:
 *    earliest rule in the original list wins.
 * 4. Projects the rule's `resolvedIdentity` JSON + taxonomy fields into a
 *    flat `AdapterMatch`, omitting absent identity fields entirely.
 *
 * Web/API code MUST call this adapter rather than evaluating rules directly.
 */
export function matchInventoryEntity(
  observation: FingerprintRuleObservation,
  context: { rules: AdapterRule[] },
): AdapterMatch | null {
  const activeRules = context.rules.filter((rule) => rule.status === "active");
  if (activeRules.length === 0) {
    return null;
  }

  let best: { rule: AdapterRule; combinedConfidence: number } | null = null;

  for (const rule of activeRules) {
    const evaluation = evaluateFingerprintRule(
      {
        ruleKey: rule.ruleKey,
        requiredEvidenceFamilies: rule.requiredEvidenceFamilies,
        matchExpression: rule.matchExpression,
      },
      observation,
    );

    if (!evaluation.matched) {
      continue;
    }

    const combinedConfidence = rule.identityConfidence + rule.taxonomyConfidence;

    if (best === null || combinedConfidence > best.combinedConfidence) {
      best = { rule, combinedConfidence };
    }
  }

  if (best === null) {
    return null;
  }

  const { rule, combinedConfidence } = best;
  return {
    ruleId: rule.id,
    ruleKey: rule.ruleKey,
    taxonomyNodeId: rule.taxonomyNodeId,
    identityConfidence: rule.identityConfidence,
    taxonomyConfidence: rule.taxonomyConfidence,
    combinedConfidence,
    ...rule.resolvedIdentity,
  };
}
