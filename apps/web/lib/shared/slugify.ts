// apps/web/lib/shared/slugify.ts
//
// Canonical kebab-case slug transform — the single source of truth for the
// "lowercase, collapse non-alphanumerics to a single dash, trim boundary
// dashes" chain that was copied verbatim at ~21 call sites (business-model,
// project-events, mcp-tools, branding, promotions, work-capsules, the build
// branch-name generators, the db product-id generators, ...). Each of those
// hand-rolled the same `.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`
// pipeline, with cosmetic divergences (`^-|-$` vs `^-+|-+$` vs `(^-|-$)`) that
// were already drifting live — all three produce identical output because the
// `[^a-z0-9]+` collapse guarantees a run can never appear at a boundary.
//
// Pure data + pure function only (no Prisma / server-only / React imports) so
// server actions, API routes, db-package callers, and client components can all
// import it.
//
// NOTE — what this is NOT. Do not fold normalizers with a *different output
// alphabet* into this function:
//   * `slugifyReferenceModelName` (BMR keys) — different rules.
//   * the workbook header/key normalizers that emit `_` (snake_case) or a space.
//   * `[^a-z0-9._-]` GAID / `[^a-z0-9-]` storefront-slug normalizers that keep
//     dots / underscores / pre-existing hyphens.
// Those are genuinely different transforms; collapsing them here would change
// their output. Callers that need a length cap or a non-empty fallback compose
// those around the slug (`slugify(x).slice(0, N)`, `slugify(x) || "fallback"`).

/**
 * Transform an arbitrary string into a canonical kebab-case slug:
 * lowercase, collapse every run of non-`[a-z0-9]` characters to a single `-`,
 * and strip leading/trailing dashes. Returns `""` for input with no
 * alphanumeric characters.
 *
 * @example slugify("Hello World!")        // "hello-world"
 * @example slugify("  --Already-clean-- ") // "already-clean"
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    // `[^a-z0-9]+` already collapsed every run to a single dash, so at most one
    // boundary dash can exist — strip a single `-` (linear; the `-+` form is a
    // polynomial-ReDoS footgun on uncontrolled input, flagged by js/polynomial-redos).
    .replace(/^-|-$/g, "");
}
