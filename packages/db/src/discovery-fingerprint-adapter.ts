import {
  evaluateFingerprintRule,
  type FingerprintMatchExpression,
  type FingerprintRuleObservation,
} from "./discovery-fingerprint-rules";

/**
 * Status values the adapter honors. Only `"active"` rules participate in
 * matching; `"draft"` and `"deprecated"` are filtered out. Open to extension
 * via the `(string & {})` escape hatch for future statuses (e.g. `"archived"`)
 * without losing autocomplete on the known set.
 */
export type AdapterRuleStatus = "draft" | "active" | "deprecated" | (string & {});

/**
 * Tightened view of `DiscoveryFingerprintRule` for adapter consumption.
 *
 * Intentionally narrow: the adapter only needs the fields required to
 * evaluate the rule and project a match into classification + enrichment
 * hints. Rule fields not used here (`excludedSignals`, `scope`,
 * `catalogVersionId`, etc.) are deliberately omitted — they belong to the
 * underlying rules engine, not this projection.
 */
export interface AdapterRule {
  id: string;
  ruleKey: string;
  status: AdapterRuleStatus;
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
  /**
   * `identityConfidence + taxonomyConfidence` (sum, NOT average). Carried in
   * the result for ranking across adapters / candidate sets. Callers comparing
   * scores from multiple sources should use this consistently or normalize
   * before combining.
   */
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
