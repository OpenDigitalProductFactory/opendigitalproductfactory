// Deterministic JSON serialization for hashing and signing.
//
// WHY THIS EXISTS: six modules hand-rolled their own `stableJson`/`canonicalJson`, and at
// least two of them are MUTUALLY INCOMPATIBLE — `coworker-service-catalog/delegation-receipt.ts`
// sorts keys with `localeCompare` (locale- and ICU-dependent) while `hive/result-intake.ts`
// sorts by code unit. A value canonicalised by one does not necessarily match the other.
//
// This is the correct implementation for NEW code. It deliberately does NOT replace the
// existing copies: their output is baked into issued HMAC signatures and persisted payload
// hashes, so silently changing their canonicalisation would invalidate live records.
// Migrating them requires a per-caller compatibility decision, tracked as BI-2F318FB3.
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
