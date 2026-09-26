// Canonical runtime object guard for workspace packages.
//
// Packages cannot import from apps/web, so the predicate that was hand-copied
// into @dpf/db, @dpf/storefront-templates and this package lives here once
// (plan 2026-09-08 §10.5 S5). apps/web keeps its own home with the same
// predicate, `apps/web/lib/shared/coerce.ts`. The ratchet
// scripts/check-no-local-isrecord.mjs sanctions both homes and flags new copies.

/**
 * True when `value` is a non-null, non-array object usable as a string-keyed
 * map. Narrows to `Record<string, unknown>`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
