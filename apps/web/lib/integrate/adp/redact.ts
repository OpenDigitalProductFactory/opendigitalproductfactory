// PII redaction and prompt-injection scrubbing for ADP tool responses.
//
// Runs over every MCP tool response before the LLM sees it. See
// docs/superpowers/specs/2026-04-21-adp-mcp-integration-design.md §7 for the
// rules. Never mutates the input — returns a fresh object tree.
//
// Redaction rules (applied recursively, case-insensitive on keys):
//   * SSN / TaxID / governmentID  → "xxx-xx-####"  (last 4 preserved)
//   * Values matching SSN pattern → "xxx-xx-####"  (even if key is generic)
//   * bank/routing/account number → "****####"    (last 4 preserved)
//   * dateOfBirth / birthDate     → year-only     ("1984")
//   * free-text fields            → jailbreak scrub + suspicious-content flag

export interface RedactResult<T = unknown> {
  value: T;
  suspiciousContentDetected: boolean;
}

const SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/;
const SSN_KEY = /^(ssn|taxid|tax_id|governmentid|government_id)$/i;
const BANK_KEY = /(account|routing)[-_]?number$/i;
const DOB_KEY = /^(birthdate|dateofbirth|date_of_birth|dob)$/i;
const FREE_TEXT_KEY = /^(note|notes|comment|comments|description|remark|remarks|memo)$/i;

// Conservative jailbreak pattern list. Matches common prompt-injection forms
// seen in LLM red-team literature and in-the-wild attempts. Not exhaustive —
// paired with the suspiciousContentDetected flag so defense-in-depth applies.
const JAILBREAK_PATTERNS = [
  /ignore\s+(all\s+|previous\s+|prior\s+)?(instructions|rules|policy|guidance)/i,
  /disregard\s+(all\s+|previous\s+|prior\s+)?(instructions|rules|policy|guidance|prompt)/i,
  /(you|u)\s+are\s+(now\s+)?(an?\s+)?(unrestricted|unfiltered|jailbroken|free)/i,
  /^system\s*:/im,
  /\[system\]/i,
  /forget\s+(everything|all)\s+(above|before)/i,
  /new\s+instructions?\s*:/i,
  /override\s+(your|the)\s+(instructions|directives|prompt)/i,
];

export function redact<T>(input: T): RedactResult<T> {
  const flag = { suspicious: false };
  const value = walk(input, null, flag) as T;
  return { value, suspiciousContentDetected: flag.suspicious };
}

function walk(node: unknown, parentKey: string | null, flag: { suspicious: boolean }): unknown {
  if (node === null || node === undefined) return node;

  if (typeof node === "string") {
    return transformString(node, parentKey, flag);
  }

  if (Array.isArray(node)) {
    return node.map((item) => walk(item, parentKey, flag));
  }

  if (typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      out[key] = walk(val, key, flag);
    }
    return out;
  }

  return node;
}

function transformString(
  value: string,
  parentKey: string | null,
  flag: { suspicious: boolean },
): string {
  // Value-pattern first: SSN-looking strings regardless of surrounding key.
  if (SSN_PATTERN.test(value)) {
    return `xxx-xx-${value.slice(-4)}`;
  }

  const keyLower = parentKey ? parentKey.toLowerCase() : "";

  // SSN / TaxID / governmentID by key name
  if (SSN_KEY.test(keyLower)) {
    return `xxx-xx-${lastFourDigits(value)}`;
  }

  // Bank account / routing / generic account number fields
  if (BANK_KEY.test(keyLower)) {
    return `****${lastFourDigits(value)}`;
  }

  // Date of birth — keep year only
  if (DOB_KEY.test(keyLower)) {
    const yearMatch = value.match(/^(\d{4})/);
    if (yearMatch) return yearMatch[1]!;
  }

  // Free-text fields — scan for prompt-injection patterns
  if (FREE_TEXT_KEY.test(keyLower)) {
    return scrubFreeText(value, flag);
  }

  return value;
}

function lastFourDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "0000";
  return digits.slice(-4).padStart(4, "0");
}

function scrubFreeText(text: string, flag: { suspicious: boolean }): string {
  // Split into sentence-ish units. Very loose — free text from payroll narratives
  // isn't structured English, so we favor over-splitting to under-scrubbing.
  const chunks = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.length > 0);

  const kept: string[] = [];
  let anyMatched = false;

  for (const chunk of chunks) {
    if (JAILBREAK_PATTERNS.some((pattern) => pattern.test(chunk))) {
      anyMatched = true;
      continue;
    }
    kept.push(chunk);
  }

  if (anyMatched) flag.suspicious = true;

  if (kept.length === 0) {
    return anyMatched ? "[content suppressed: suspicious pattern]" : text;
  }

  return kept.join(" ");
}
