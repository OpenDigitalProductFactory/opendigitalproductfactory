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

export type RouteShellPolicy = {
  routePath: string;
  shell: UxShell;
  /** True once the route has adopted its L1 shell. */
  migrated: boolean;
  /** Checks waived while the route is pre-migration — recorded baseline debt. */
  exemptChecks: readonly ExemptCheck[];
};

export function shellPolicyFor(routePath: string, c: ShellClassifiable): RouteShellPolicy {
  const migrated = MIGRATED_ROUTES.has(routePath);
  return {
    routePath,
    shell: shellForRoute(c),
    migrated,
    exemptChecks: migrated ? [] : PRE_MIGRATION_EXEMPT_CHECKS,
  };
}
