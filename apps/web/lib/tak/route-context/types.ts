// apps/web/lib/tak/route-context/types.ts
//
// The page-owned context contract (design spec 2026-08-05, Option B / Phase 2).
// Each portal surface declares a PageContextProvider that returns the same data
// the page renders, so the coworker perceives the page the user is on. The
// `match` mode is the load-bearing fix for the prefix-fallthrough flaw class
// (e.g. /ops/self-upgrade inheriting the /ops backlog): an `exact` provider's
// data is NEVER returned for a descendant route — an unowned descendant falls to
// the name-label default instead of a sibling's data.

export interface PageContextInput {
  /** The id of the user viewing the page (for user-scoped data). */
  userId: string;
  /** The pathname the coworker was told the user is on (already normalized). */
  route: string;
}

export interface PageContextProvider {
  /** The route this provider owns, e.g. "/ops" or "/compliance". */
  route: string;
  /**
   * exact  → this provider matches ONLY `route` (its data never leaks to a
   *          descendant like `${route}/child`).
   * prefix → this provider matches `route` and every descendant `${route}/...`
   *          (used by providers that genuinely parse/serve their subtree, e.g.
   *          /compliance parsing a regulation id).
   */
  match: "exact" | "prefix";
  /** Build the PAGE DATA block, or null to contribute nothing. */
  build: (input: PageContextInput) => Promise<string | null>;
}
