/**
 * No-fabrication invariant (BI-B2497DFB, AC4).
 *
 * The load-bearing safety rule: enrichment NEVER synthesizes an identity value.
 * If a source only exposes a masked/partial value (a public directory showing
 * `g***@teamlogicit.com`, a `(512) ***-1234` phone), the coworker must leave the
 * field blank and surface it as a confirm-what's-needed gap — it must NOT
 * materialize the masked pattern into a real-looking value. This guard is the
 * single decision point; the proposal builder routes every finding through it,
 * and the regression test (masked email MUST NOT be materialized) pins it.
 */
import type { EnrichableField } from "./types";

export type MaterializabilityVerdict =
  | { materializable: true }
  | { materializable: false; reason: string };

/**
 * A run of 2+ mask glyphs (`*`, `•`, `●`, `∗`, `＊`, `#`) or a standalone `xxx`
 * mask word. Kept to runs so ordinary punctuation does not trip it.
 */
const MASK_RUN = /[*•●∗＊#]{2,}|(?:\bx{3,}\b)/i;
/**
 * A mask glyph adjacent to an alphanumeric (e.g. `g***@`, `j.d***`) — the
 * partial-identity case. Adjacency (not bare presence) so a bulleted `notes`
 * value like "• MSP • Austin" is not misread as masked.
 */
const EMBEDDED_MASK = /[A-Za-z0-9][*•●∗＊]|[*•●∗＊][A-Za-z0-9]/;

/** Name fields where common surnames collide with placeholder tokens ("Na"). */
const NAME_FIELDS = new Set(["firstName", "lastName", "name"]);

const PLACEHOLDER_TOKENS = [
  "n/a",
  "na",
  "none",
  "unknown",
  "not found",
  "notfound",
  "not available",
  "redacted",
  "tbd",
  "todo",
  "null",
  "undefined",
  "-",
  "—",
  "example.com",
  "test@test.com",
  "no email",
  "no phone",
];

function looksMasked(value: string): boolean {
  return MASK_RUN.test(value) || EMBEDDED_MASK.test(value);
}

function isPlaceholder(value: string): boolean {
  const lowered = value.trim().toLowerCase();
  if (PLACEHOLDER_TOKENS.includes(lowered)) return true;
  // Placeholder emails / domains commonly used to signal "unknown".
  if (/@(?:example|test|placeholder)\.(?:com|org|net)$/i.test(lowered)) return true;
  return false;
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Decide whether a researched value may be written to a field. Rejects empty,
 * placeholder, and masked/partial values. Field-specific checks: emails must be
 * a full unmasked address; phones must carry enough real digits to be a number,
 * not a masked stub.
 */
export function evaluateMaterializability(
  field: EnrichableField | "email" | (string & {}),
  rawValue: string,
): MaterializabilityVerdict {
  const value = (rawValue ?? "").trim();
  if (value.length === 0) {
    return { materializable: false, reason: "empty" };
  }
  // Name fields skip the placeholder-token list: real surnames ("Na", "None")
  // collide with it. Empty/masked are still caught above/below.
  if (!NAME_FIELDS.has(field) && isPlaceholder(value)) {
    return { materializable: false, reason: "placeholder value, not a real datum" };
  }
  if (looksMasked(value)) {
    return {
      materializable: false,
      reason: "masked/partial value — the source hid part of it; never synthesize the rest",
    };
  }

  // Field-specific identity guards.
  if (/email/i.test(field)) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { materializable: false, reason: "not a complete, unmasked email address" };
    }
  }
  if (field === "phone") {
    if (digitsOnly(value).length < 7) {
      return { materializable: false, reason: "too few real digits to be a phone number" };
    }
  }
  if (field === "linkedinUrl" || field === "website") {
    if (!/[a-z0-9]/i.test(value)) {
      return { materializable: false, reason: "no usable url content" };
    }
  }

  return { materializable: true };
}

/** Convenience boolean for callers that only need the verdict. */
export function isMaterializableValue(
  field: EnrichableField | "email" | (string & {}),
  value: string,
): boolean {
  return evaluateMaterializability(field, value).materializable;
}
