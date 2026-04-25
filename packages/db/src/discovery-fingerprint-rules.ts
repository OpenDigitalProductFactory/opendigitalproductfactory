export type FingerprintMatchClause =
  | { type: "exact"; path: string; value: string }
  | { type: "contains"; path: string; value: string }
  | { type: "regex"; path: string; pattern: string }
  | { type: "snmp_oid_prefix"; path: string; value: string };

export type FingerprintMatchExpression =
  | { all: FingerprintMatchClause[] }
  | { any: FingerprintMatchClause[] };

export type FingerprintRuleInput = {
  ruleKey: string;
  requiredEvidenceFamilies: string[];
  matchExpression: FingerprintMatchExpression;
};

export type FingerprintRuleObservation = {
  evidenceFamilies: string[];
  normalizedEvidence: unknown;
};

export type FingerprintRuleEvaluation = {
  matched: boolean;
  ruleKey: string;
  reasons: string[];
};

export function evaluateFingerprintRule(
  rule: FingerprintRuleInput,
  observation: FingerprintRuleObservation,
): FingerprintRuleEvaluation {
  const reasons = missingEvidenceReasons(rule.requiredEvidenceFamilies, observation.evidenceFamilies);

  if (reasons.length > 0) {
    return { matched: false, ruleKey: rule.ruleKey, reasons };
  }

  const clauseResults =
    "all" in rule.matchExpression
      ? rule.matchExpression.all.map((clause) => evaluateClause(clause, observation.normalizedEvidence))
      : rule.matchExpression.any.map((clause) => evaluateClause(clause, observation.normalizedEvidence));

  const matched = "all" in rule.matchExpression ? clauseResults.every(Boolean) : clauseResults.some(Boolean);

  return {
    matched,
    ruleKey: rule.ruleKey,
    reasons: matched ? [] : ["match_expression_failed"],
  };
}

function missingEvidenceReasons(required: string[], available: string[]): string[] {
  const availableSet = new Set(available);
  return required
    .filter((family) => !availableSet.has(family))
    .map((family) => `missing_required_evidence_family:${family}`);
}

function evaluateClause(clause: FingerprintMatchClause, evidence: unknown): boolean {
  const value = readPath(evidence, clause.path);
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return false;
  }

  const actual = String(value);

  switch (clause.type) {
    case "exact":
      return actual === clause.value;
    case "contains":
      return actual.includes(clause.value);
    case "regex":
      return matchesRegex(actual, clause.pattern);
    case "snmp_oid_prefix":
      return actual.startsWith(clause.value);
  }
}

function readPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, source);
}

function matchesRegex(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}
