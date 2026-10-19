/**
 * The prose keyword heuristic behind deriveDeliverableSensitivity, in its own
 * module so a caller that must explain a raise can name the matched word
 * (BI-243BC956) without a second copy of these patterns. Dependency-free on
 * purpose: build-process-matrix imports it, never the reverse.
 */

// Bare "card"/"charge"/"token" are deliberately excluded — they over-match benign
// prose ("dashboard card", "charge up", LLM "token/cost"). Payment and credential
// exposure are caught by the billing/PCI/card and auth/api/bearer-token terms.
const HIGH_SENSITIVITY_PATTERN =
  /\b(auth|authn|authz|authentication|authorization|login|sign[- ]?in|password|credential|secret|(?:auth|access|bearer|refresh|session|oauth|api)[- ]?tokens?|api[- ]?key|billing|payment|invoice|pci|cardholder|credit[- ]?card|debit[- ]?card|customer[- ]?data|pii|personal[- ]?data|gdpr|hipaa|security|vulnerab|encrypt|crypto|kernel|governance|rbac|permission|access[- ]?control|compliance)\b/i;
const ELEVATED_SENSITIVITY_PATTERN =
  /\b(database|migration|schema|prisma|integration|external|webhook|email|outbound|federation|edge|endpoint|deploy|infrastructure)\b/i;

/**
 * The keyword the heuristic matched, and the level it implies. Exposed so a
 * caller that has to explain a raise can name the word that caused it
 * (BI-243BC956) instead of re-running a private copy of these patterns.
 */
export function matchDeliverableSensitivityKeyword(
  text: string | null | undefined,
): { level: "low" | "elevated" | "high"; keyword: string | null } {
  const value = text ?? "";
  const high = HIGH_SENSITIVITY_PATTERN.exec(value);
  if (high) return { level: "high", keyword: high[0].toLowerCase() };
  const elevated = ELEVATED_SENSITIVITY_PATTERN.exec(value);
  if (elevated) return { level: "elevated", keyword: elevated[0].toLowerCase() };
  return { level: "low", keyword: null };
}
