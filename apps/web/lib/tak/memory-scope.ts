// apps/web/lib/tak/memory-scope.ts
// Two-scope memory classifier — BI-1772D0B7 (EP-8C706944 Phase 4).
//
// All conversational/episodic memory was siloed per human user, so a coworker
// serving ten employees kept ten disjoint memories and could not carry an
// org-relevant fact between them — while some content genuinely must stay
// private. This is the write-time decision the founder called out: for each
// durable memory item, is it ORG-shared (a durable business fact that belongs to
// the organization) or USER-private (a personal relationship preference), and is
// it SENSITIVE (must never leave its originating user regardless of scope)?
//
// GitHub Copilot Memory's production split — repo-scoped shared facts vs private
// user preferences — mapped onto DPF's fact categories. Deterministic and
// unit-testable; the runner tags each fact at write time.

export type MemoryScope = "org" | "user";
export type MemorySensitivity = "normal" | "sensitive";

export type MemoryScopeDecision = {
  scope: MemoryScope;
  sensitivity: MemorySensitivity;
  reason: string;
};

/**
 * Categories whose facts are about the BUSINESS, not the person — these default
 * to org scope (the fact belongs to the organization, per
 * learnings-belong-in-the-shared-commons).
 */
const ORG_CATEGORIES = new Set(["decision", "constraint", "domain_context"]);

/** `preference` is inherently personal → always user scope. */
const USER_CATEGORIES = new Set(["preference"]);

/**
 * Signals that a fact is sensitive and must not be shared across users even when
 * its category would otherwise be org-scoped (health, pay, personal identifiers,
 * credentials, private/confidential markers).
 */
const SENSITIVE_PATTERNS = [
  /\b(salary|compensation|pay|wage|bonus)\b/i,
  /\b(health|medical|diagnosis|disability|illness)\b/i,
  /\b(password|secret|api[_\s-]?key|token|credential|ssn|passport)\b/i,
  /\b(personal|private|confidential|do not share|off the record)\b/i,
  /\b(home address|date of birth|dob)\b/i,
];

function isSensitive(key: string, value: string): boolean {
  const hay = `${key} ${value}`;
  return SENSITIVE_PATTERNS.some((re) => re.test(hay));
}

/**
 * Classify a fact's scope + sensitivity at write time.
 *
 * - Sensitive content is ALWAYS user-private, whatever its category.
 * - `preference` is user-private (personal taste).
 * - `decision` / `constraint` / `domain_context` are org-shared business facts.
 * - Anything unrecognized falls back to the safe default (user-private).
 */
export function classifyMemoryScope(fact: {
  category: string;
  key: string;
  value: string;
}): MemoryScopeDecision {
  const sensitivity: MemorySensitivity = isSensitive(fact.key, fact.value)
    ? "sensitive"
    : "normal";

  // Sensitive always stays private — this dominates the category signal.
  if (sensitivity === "sensitive") {
    return { scope: "user", sensitivity, reason: "sensitive content stays with its user" };
  }

  if (USER_CATEGORIES.has(fact.category)) {
    return { scope: "user", sensitivity, reason: `${fact.category} is personal` };
  }
  if (ORG_CATEGORIES.has(fact.category)) {
    return { scope: "org", sensitivity, reason: `${fact.category} is an org-level business fact` };
  }
  return { scope: "user", sensitivity, reason: "unrecognized category → private by default" };
}
