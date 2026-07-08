// apps/web/lib/routes.ts
//
// Canonical named constants for the app's top-level route paths — the single
// source of truth for the string literals passed to `revalidatePath(...)`,
// `redirect(...)`, and `<Link href>` across ~120 call sites. The bare literals
// `"/compliance"` (47×), `"/employee"` (40×), `"/ops"` (16×), `"/portfolio"`
// (13×), … were retyped at every server action, so a rename (or a typo like
// `"/complaince"`) silently no-ops the revalidation with no compile error.
//
// Referencing `ROUTES.compliance` makes a rename a single-edit, compiler-checked
// change and turns typos into build failures.
//
// Pure data only (no imports) so server actions, route handlers, and client
// components can all import it. This is a curated map of the HIGH-FREQUENCY
// section roots, not an exhaustive registry — add an entry when a path earns
// repeated reuse; deep/parameterized paths stay inline at their single site.

export const ROUTES = {
  compliance: "/compliance",
  employee: "/employee",
  ops: "/ops",
  portfolio: "/portfolio",
  customer: "/customer",
  admin: "/admin",
  adminPlatformDevelopment: "/admin/platform-development",
  workspace: "/workspace",
  finance: "/finance",
  financeAp: "/finance/ap",
  governance: "/governance",
  build: "/build",
  knowledge: "/knowledge",
  inventory: "/inventory",
  rental: "/rental",
  platform: "/platform",
  platformAi: "/platform/ai",
  ea: "/ea",
} as const;

/** A known top-level route path value (e.g. `"/compliance"`). */
export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
