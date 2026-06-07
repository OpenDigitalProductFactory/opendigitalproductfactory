export type FingerprintMatchClause =
  | { type: "exact"; path: string; value: string }
  | { type: "contains"; path: string; value: string }
  | { type: "regex"; path: string; pattern: string }
  | { type: "snmp_oid_prefix"; path: string; value: string }
  // DHCP Option 55 ordered parameter-request-list (the Fingerbank discriminant).
  // `value` is the ordered option-code prefix to match — accepted as either a
  // comma-separated string ("1,3,6,15,119,252") or an array. The observation's
  // value at `path` may likewise be an array or a comma-separated string; a
  // match means the observed ordered list STARTS WITH the rule's sequence.
  | { type: "ordered_list_prefix"; path: string; value: string | (string | number)[] };

export type FingerprintMatchExpression =
  | { all: FingerprintMatchClause[] }
  | { any: FingerprintMatchClause[] };

/**
 * Comparator `type` values this engine version understands. Used to skip
 * (not crash on) catalog rules authored against a newer schemaVersion that
 * introduces comparators an older install cannot evaluate (spec §10:
 * "older installs must skip rules they can't evaluate rather than crash").
 */
export const SUPPORTED_COMPARATOR_TYPES: ReadonlySet<string> = new Set([
  "exact",
  "contains",
  "regex",
  "snmp_oid_prefix",
  "ordered_list_prefix",
]);

/**
 * Catalog schemaVersion this engine can fully evaluate. Bumped to 2 when the
 * `ordered_list_prefix` comparator (DHCP Option 55) was added. A catalog
 * declaring a higher schemaVersion may contain comparators this engine does not
 * understand; such rules are skipped (see `ruleUsesUnsupportedComparator`), not
 * crashed on (spec §10).
 */
export const FINGERPRINT_ENGINE_SCHEMA_VERSION = 2;

/**
 * Resolved device/software identity carried by a fingerprint rule.
 *
 * Extended (spec §5.3) from the original `{ kind, name, vendor }` to add:
 *  - `model`       — specific model when a signal disambiguates it (often unknown
 *                    for OUI-only rules; left undefined rather than guessed).
 *  - `deviceClass` — the canonical class the DPPM placement algorithm maps to a
 *                    Foundational sub-portfolio taxonomyNodeId (e.g. "ip_camera",
 *                    "smart_plug", "thermostat", "client_endpoint").
 *
 * `resolvedIdentity` is a JSON column, so adding these fields requires no SQL
 * migration — only the type and the seed/fixture data.
 */
export type ResolvedIdentity = {
  kind: string;
  name: string;
  vendor?: string;
  model?: string;
  deviceClass?: string;
};

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

/**
 * True when the rule references at least one comparator `type` this engine
 * version does not support. Loaders/adapters use this to skip such rules
 * rather than mis-evaluate them.
 */
export function ruleUsesUnsupportedComparator(rule: FingerprintRuleInput): boolean {
  return collectClauses(rule.matchExpression).some(
    (clause) => !SUPPORTED_COMPARATOR_TYPES.has((clause as { type?: string }).type ?? ""),
  );
}

function collectClauses(expression: FingerprintMatchExpression): FingerprintMatchClause[] {
  return "all" in expression ? expression.all : expression.any;
}

export function evaluateFingerprintRule(
  rule: FingerprintRuleInput,
  observation: FingerprintRuleObservation,
): FingerprintRuleEvaluation {
  const reasons = missingEvidenceReasons(rule.requiredEvidenceFamilies, observation.evidenceFamilies);

  if (reasons.length > 0) {
    return { matched: false, ruleKey: rule.ruleKey, reasons };
  }

  // Forward/backward-compat (spec §10): a rule authored against a newer
  // catalog schemaVersion may use a comparator this engine cannot evaluate.
  // Skip it (no match) rather than crash or guess.
  if (ruleUsesUnsupportedComparator(rule)) {
    return { matched: false, ruleKey: rule.ruleKey, reasons: ["unsupported_comparator"] };
  }

  const clauses = collectClauses(rule.matchExpression);
  const clauseResults = clauses.map((clause) => evaluateClause(clause, observation.normalizedEvidence));
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
  // The ordered-list comparator reads a list (array or comma-joined string),
  // so it inspects the raw value before scalar coercion.
  if (clause.type === "ordered_list_prefix") {
    return matchesOrderedListPrefix(readPath(evidence, clause.path), clause.value);
  }

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
    default:
      // Unknown comparator — never reached for catalogs that pass
      // ruleUsesUnsupportedComparator, but fail closed (no match) defensively.
      return false;
  }
}

function toListTokens(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim());
  }
  if (typeof value === "string") {
    if (value.trim() === "") {
      return [];
    }
    return value.split(",").map((token) => token.trim());
  }
  return null;
}

function matchesOrderedListPrefix(observed: unknown, expected: string | (string | number)[]): boolean {
  const observedTokens = toListTokens(observed);
  const expectedTokens = toListTokens(expected);
  if (observedTokens === null || expectedTokens === null) {
    return false;
  }
  if (expectedTokens.length === 0 || expectedTokens.length > observedTokens.length) {
    return false;
  }
  return expectedTokens.every((token, index) => observedTokens[index] === token);
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
