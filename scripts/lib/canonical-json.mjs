// scripts/lib/canonical-json.mjs
//
// Canonical JSON for plain-Node scripts (plan 2026-09-08 §10.5 S4). Scripts cannot
// import the TypeScript home (@dpf/integration-shared/canonical-json), so this is the
// one sanctioned copy for scripts/. The two are byte-identical for every input:
// packages/integration-shared/src/canonical-json.test.ts proves it over randomized
// input. Change both or neither — the output is hashed and signed.
//
// scripts/check-no-local-canonical-json.mjs flags any other local canonicaliser.
//
// Semantics: object keys sorted by UTF-16 code unit (never localeCompare); arrays kept in
// order; `undefined` dropped inside objects and `null` in arrays and at the top level;
// numbers as JSON.stringify (-0 is 0, NaN and ±Infinity are null); toJSON is not called,
// so a Date is {}; bigint throws.

/** @param {string} left @param {string} right */
function byCodeUnit(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Serialize a value to a canonical string for hashing and signing.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => byCodeUnit(left, right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}
