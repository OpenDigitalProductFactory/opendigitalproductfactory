// apps/web/lib/ux-budget/route-shells.ts
//
// Route → intended page shell — EP-UX-SYSTEM spec §6 L2 / §7.1 (BI-B9BE9A29).
//
// SUBSTRATE DECISION: this does NOT hand-author 307 route classifications, and it does
// NOT fork the route inventory. The platform already classifies every page route by
// AUDIENCE and DESTINATION KIND (lib/navigation/route-audience.ts, BI-8C0F219A), which
// is itself layered on the single route-inventory source of truth
// (lib/ea/route-manifest.json). Intended shell is DERIVED from those two axes. A second
// hand-maintained registry of the same routes would drift from the first within weeks —
// the spec's own §6 L1 rule about not creating a second manifest home, applied here.
//
// What this adds that the audience registry does not: the shell a surface should be
// built as, and whether that surface has actually been MIGRATED to its shell yet.

import type { RouteAudience, RouteDestinationKind } from "../navigation/route-audience";
import type { UxShell } from "./budgets";

export type ShellClassifiable = {
  audience: RouteAudience;
  destinationKind: RouteDestinationKind;
};

/**
 * Derive the intended shell. Ordered rules: the shape of the destination decides
 * first (a settings page is a settings page whoever it is for), then the audience.
 */
export function shellForRoute(c: ShellClassifiable): UxShell {
  // Redirect shims and deprecated surfaces are not worth a shell.
  if (c.destinationKind === "legacy-internal") return "unclassified";
  if (c.destinationKind === "settings-config") return "settings";
  if (c.destinationKind === "workflow-step") return "form";
  if (c.audience === "public") return "public";
  // Login / signup / credential recovery are forms first, public second.
  if (c.audience === "auth-setup") return "form";
  if (c.destinationKind === "detail") return "detail";
  // Deep technical surfaces are detail pages with a higher tolerance.
  if (c.destinationKind === "advanced-diagnostic") return "detail";
  if (c.destinationKind === "section-home") {
    // An owner's section home is their cockpit; a builder/admin console is a
    // dense working list and is budgeted as one.
    return c.audience === "admin" || c.audience === "builder" ? "list" : "cockpit";
  }
  return "unclassified";
}

/**
 * Routes that have actually adopted their L1 page shell.
 *
 * INTENTIONALLY EMPTY. The shells themselves are BI-36CE8BAB (Phase 2) — nothing has
 * migrated yet, and saying so in code is the point: spec §7.1 requires pre-migration
 * debt to be RECORDED, not hidden behind a check that quietly passes. Until a route
 * appears here it is exempt from the shell-structure expectations below, and the
 * regression ratchet is what actually holds it.
 *
 * Each migration PR (spec §7.2) adds its route here in the same change that adopts
 * the shell, so the exemption list shrinks visibly as the redesign lands.
 */
export const MIGRATED_ROUTES: ReadonlySet<string> = new Set<string>([]);

/** Checks a pre-migration route is not yet expected to satisfy. */
export const PRE_MIGRATION_EXEMPT_CHECKS = ["next-action-marker", "lead-band"] as const;
export type ExemptCheck = (typeof PRE_MIGRATION_EXEMPT_CHECKS)[number];

export const ROUTE_SWEEP_EXCLUSION_REASONS = [
  "dynamic-fixture-required",
  "customer-session-required",
  "storefront-setup-required",
  "setup-phase-only",
  "fixture-capability-unavailable",
  "redirects-to-dynamic-resource",
  "wall-clock-collection",
] as const;
export type RouteSweepExclusionReason =
  (typeof ROUTE_SWEEP_EXCLUSION_REASONS)[number];

/**
 * Static routes the owner-fixture sweep cannot measure honestly.
 *
 * This is policy layered on the canonical route inventory, not a second inventory:
 * the generated registry below includes every route and records either measurable or
 * one explicit reason. The non-wall-clock routes here were confirmed across
 * repeated same-SHA CI runs. They need a different authenticated/fixture context, intentionally redirect,
 * or depend on a capability the generic fixture does not provision.
 *
 * Keep this list shrink-only where possible. A route becomes eligible in the same PR
 * that adds its honest fixture context.
 */
export const ROUTE_SWEEP_EXCLUSIONS = {
  "/admin/backups": "fixture-capability-unavailable",
  "/finance/funds": "fixture-capability-unavailable",
  "/governance": "fixture-capability-unavailable",
  "/governance/records-requests": "fixture-capability-unavailable",
  "/member-equity": "fixture-capability-unavailable",
  "/rental": "fixture-capability-unavailable",
  "/service-requests": "fixture-capability-unavailable",

  "/customer-login": "customer-session-required",
  "/portal": "customer-session-required",
  "/portal/account": "customer-session-required",
  "/portal/cases": "customer-session-required",
  "/portal/health": "customer-session-required",
  "/portal/orders": "customer-session-required",
  "/portal/services": "customer-session-required",
  "/portal/sign-up": "customer-session-required",
  "/portal/support": "customer-session-required",

  "/storefront/animals": "storefront-setup-required",
  "/storefront/inbox": "storefront-setup-required",
  "/storefront/items": "storefront-setup-required",
  "/storefront/sections": "storefront-setup-required",
  "/storefront/settings": "storefront-setup-required",
  "/storefront/tables": "storefront-setup-required",
  "/storefront/units": "storefront-setup-required",

  "/setup": "setup-phase-only",
  "/welcome": "setup-phase-only",
  "/ops/health": "redirects-to-dynamic-resource",

  // Wall-clock collections (BI-0C6C2153): these routes derive the SET of
  // visible entities from `new Date()` — calendar windows materialize upcoming
  // cron-run instances, change lanes bucket work by time window. The volatile-
  // text normalizer stabilizes timestamp PHRASING but cannot stabilize a
  // changing entity set, so an exact frozen word baseline flakes with the
  // clock (measured: /platform/schedule 331→342 words between a 01:07 and an
  // 03:26 run of untouched code). Exclude until the fixture can pin the
  // app-visible clock.
  "/platform/schedule": "wall-clock-collection",
  "/workspace/calendar": "wall-clock-collection",
  "/platform/development/change-lanes": "wall-clock-collection",
} as const satisfies Record<string, RouteSweepExclusionReason>;

export type RouteShellPolicy = {
  routePath: string;
  shell: UxShell;
  /** True once the route has adopted its L1 shell. */
  migrated: boolean;
  /** Checks waived while the route is pre-migration — recorded baseline debt. */
  exemptChecks: readonly ExemptCheck[];
  /** Whether the generic owner fixture can measure this route honestly. */
  sweepEligible: boolean;
  /** Why the route remains in inventory but outside this fixture context. */
  sweepExclusionReason?: RouteSweepExclusionReason;
};

export function shellPolicyFor(routePath: string, c: ShellClassifiable): RouteShellPolicy {
  const migrated = MIGRATED_ROUTES.has(routePath);
  const sweepExclusionReason = routePath.includes("[")
    ? "dynamic-fixture-required"
    : ROUTE_SWEEP_EXCLUSIONS[routePath as keyof typeof ROUTE_SWEEP_EXCLUSIONS];
  return {
    routePath,
    shell: shellForRoute(c),
    migrated,
    exemptChecks: migrated ? [] : PRE_MIGRATION_EXEMPT_CHECKS,
    sweepEligible: sweepExclusionReason === undefined,
    ...(sweepExclusionReason ? { sweepExclusionReason } : {}),
  };
}
