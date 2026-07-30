/**
 * Dependency-free runtime implementation behind the canonical TypeScript
 * coercion API. Kept as ESM so host-side Node policy tests and the web bundle
 * execute the same predicate.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
