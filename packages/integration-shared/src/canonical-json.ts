// Deterministic JSON serialization for hashing and signing.
//
// WHY THIS EXISTS: modules hand-rolled their own `stableJson`/`canonicalJson`, and they are
// MUTUALLY INCOMPATIBLE — some sort keys with `localeCompare` (locale- and ICU-dependent),
// some by code unit; some drop `undefined`, some write the literal text `undefined`, some
// throw; some rebuild objects, which moves integer-like keys ("2" before "10") ahead of the
// rest. A value canonicalised by one does not necessarily match another.
//
// ONE HOME PER IMPORT BOUNDARY (plan 2026-09-08 §10.5 S4):
//   TypeScript (apps/web, packages/*)  import { canonicalJson } from "@dpf/integration-shared/canonical-json";
//   plain-Node scripts (scripts/**)    import { canonicalJson } from "./lib/canonical-json.mjs";
// Plain .mjs cannot load this TypeScript source, so scripts/lib/canonical-json.mjs is the
// second home. The two are byte-identical; canonical-json.test.ts proves it over randomized
// input.
//
// This is the correct implementation for NEW code. It deliberately does NOT replace the
// remaining copies: their output is baked into issued HMAC signatures and persisted payload
// hashes, and none is byte-identical to this one, so switching any of them changes live
// hashes. Each copy is listed, with its exact difference, in the ALLOWLIST of
// scripts/check-no-local-canonical-json.mjs; migrating one is a per-caller compatibility
// decision (BI-2F318FB3).
//
// Ordering is by UTF-16 code unit, which is the only sort that is stable across runtimes:
// `localeCompare` without an explicit locale resolves against the host's default locale and
// ICU data, so the same input can canonicalise differently on two machines — which turns a
// signature mismatch into a false tampering signal.

/** Compare by code unit. Deliberately not `localeCompare` — see the module comment. */
function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Serialize a value to a canonical string: object keys sorted deterministically, arrays in
 * their given order (array order is semantic and must never be sorted).
 *
 * `undefined` values inside objects are dropped, matching `JSON.stringify` semantics, so a
 * key that is absent and a key that is explicitly `undefined` canonicalise identically.
 *
 * Exact semantics (the output is hashed and signed, so these are a contract):
 * - keys: sorted by UTF-16 code unit, integer-like keys included ("10" before "2");
 * - `undefined`: dropped inside objects, `null` inside arrays and at the top level;
 * - numbers: as `JSON.stringify` — `-0` is `0`, `NaN` and `±Infinity` are `null`;
 * - a `Date` or any other object is walked by its own enumerable keys; `toJSON` is not
 *   called, so a `Date` is `{}`. Convert dates to strings before canonicalising;
 * - `bigint` throws, as `JSON.stringify` does.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => byCodeUnit(left, right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  // JSON.stringify(undefined) is undefined, not a string — normalise so a bare undefined
  // never yields the literal string "undefined" in a signed payload.
  return value === undefined ? "null" : JSON.stringify(value);
}
