// apps/web/lib/shared/coerce.ts
//
// Canonical JSON-shape coercion helpers — the single source of truth for the
// "narrow an `unknown` (a `Prisma.JsonValue`, a parsed request body, an LLM
// tool-call payload) to a usable primitive" chain that was hand-copied at 20+
// call sites. The `isRecord` object-guard alone was duplicated verbatim in
// ≥6 files (lib/build/{decomposition-candidates,amend-epic-decomposition,
// task-results,verification-output,sandbox-state}, lib/integrate/
// build-requirements-context, lib/brand/task-status, lib/mobile/manifest, …),
// each re-deriving the same `typeof === "object" && !== null && !isArray`
// predicate with cosmetic divergences (`!!value` vs `value !== null` vs
// `Boolean(value)` — all identical in behaviour).
//
// Pure functions only (no Prisma / server-only / React imports) so every layer
// can import it.
import { isRecord as isRecordRuntime } from "./is-record.mjs";

/**
 * True when `v` is a plain (non-array, non-null) object usable as a string-keyed
 * map. Narrows to `Record<string, unknown>` so property access on a
 * `Prisma.JsonValue` / `unknown` typechecks.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return isRecordRuntime(v);
}

/**
 * Coerce `v` to a string when it already is one, else `fallback`.
 * Non-strings (numbers, booleans, null, objects) are NOT stringified — this is a
 * narrowing accessor for JSON values, not a formatter. `fallback` defaults to
 * `undefined` so `asString(x)` is a total function returning `string | undefined`.
 */
export function asString(v: unknown): string | undefined;
export function asString(v: unknown, fallback: string): string;
export function asString(v: unknown, fallback?: string): string | undefined {
  return typeof v === "string" ? v : fallback;
}

/**
 * Coerce `v` to a finite number when it already is one, else `fallback`.
 * `NaN` and `Infinity` are rejected (treated as absent). Numeric strings are
 * NOT parsed — pass the parsed value if you need that. `fallback` defaults to
 * `undefined`.
 */
export function asNumber(v: unknown): number | undefined;
export function asNumber(v: unknown, fallback: number): number;
export function asNumber(v: unknown, fallback?: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
