// scripts/lib/is-record.mjs
//
// The object guard for plain-Node scripts (plan 2026-09-08 §10.5 S5). Scripts
// cannot import the TypeScript homes (apps/web/lib/shared/coerce.ts,
// @dpf/validators), so this is the one sanctioned copy for scripts/.
// scripts/check-no-local-isrecord.mjs flags any other local definition.

/**
 * True when `value` is a non-null, non-array object usable as a string-keyed map.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
