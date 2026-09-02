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
 * Until a route appears here it is exempt from the shell-structure expectations
 * below, and the regression ratchet is what actually holds it. Spec §7.1 requires
 * pre-migration debt to be RECORDED, not hidden behind a check that quietly passes.
 *
 * Each migration PR (spec §7.2) adds its route here in the same change that adopts
 * the shell, so the exemption list shrinks visibly as the redesign lands.
 *
 * Cohort 0 — the worst-measured surface first, which is the ordering the league
 * table exists to give. `/platform/ai/skills` measured 5,349 default-visible
 * words against a 450-word budget with zero lead band; it is the proof that the
 * shells actually move the number, not just the markup.
 */
export const MIGRATED_ROUTES: ReadonlySet<string> = new Set<string>([
  "/platform/ai/skills",
]);

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
  // Workspace HOME has the same defect as its /workspace/calendar child, which was
  // already excluded: loadPlatformWorkspaceHomeData derives a calendar window from
  // the wall clock — `new Date(now.getFullYear(), now.getMonth(), -7)` through
  // `new Date(now.getFullYear(), now.getMonth() + 1, 7)` — so which calendar
  // entities are visible on arrival moves with the date, and the frozen word
  // baseline drifts on untouched code (measured: 199→211 words on a run of
  // BI-F2EC4699, whose diff touches this route only for net-zero copy). Same
  // signature and magnitude as the /platform/schedule 331→342 case above. Remove
  // once the fixture can pin the app-visible clock (BI-0C6C2153).
  "/workspace": "wall-clock-collection",
  // Live-orchestration-state routes. These drift because CONCURRENT SESSIONS and
  // in-run cron fires mutate the platform state they render, not only because the
  // clock advances — so the frozen baseline cannot hold even within a single SHA.
  // Both were caught failing on BI-F2EC4699's branch on commits that change no
  // rendered output at all (see BI-0C6C2153 for the four-run same-SHA evidence):
  //
  //   /ops/self-upgrade      structureChanged=true, no word delta, no budget
  //                          failure — it renders getSelfUpgradeStatus() +
  //                          listSelfUpgradeRuns() and stamps
  //                          new Date().toISOString(), so its heading/landmark
  //                          shape changes as runs are created and completed.
  //   /admin/scheduled-jobs  1542 -> 1784 words (+242) — every row shows
  //                          nextRunAt (computeNextCronRun(schedule, new Date())),
  //                          lastRunAt, and a health badge, and crons fire during
  //                          the sweep itself.
  //
  // Remove once the fixture pins the app-visible clock AND isolates platform state
  // from concurrent writers (BI-0C6C2153).
  "/ops/self-upgrade": "wall-clock-collection",
  "/admin/scheduled-jobs": "wall-clock-collection",
  // /platform/ai/operations-map is the same class as /ops/self-upgrade above, with
  // the identical verdict signature: structureChanged=true, regressions=[], no
  // blocking budget failure. It was observed INTERMITTENT across sweep runs that
  // nobody's diff can explain — it is the sole not-ok route in two failing runs two
  // days apart, with passing runs on both sides and in between:
  //
  //   run 30591069593  2026-07-30 23:37Z  main @ c140cc60  BLOCKED (sole route)
  //   runs on 07-31 02:30 / 02:58 / 04:02                  sweep green
  //   run 30705690653  2026-08-01 15:20Z                   sweep green
  //   run 30708524750  2026-08-01 16:36Z  @ d57b01b        BLOCKED (sole route)
  //   runs 30711415258 / 30711426386 17:56Z               sweep green
  //
  // Mechanism, on three compounding counts: loadOperationsMapData reads the live
  // orchestration set (proactive TaskRuns, ToolExecutions, TokenUsage, RouteOutcomes,
  // ProviderCapacityStatus, DeliberationRuns) that concurrent sessions and crons
  // mutate; OperationsMapLiveShell derives its fetch window from the LIVE EDGE
  // (now + LIVE_EDGE_FORECAST_PAD_MS), so the visible entity set moves with the
  // clock; and that shell re-fetches on a REFRESH_INTERVAL_MS = 45s timer, so the
  // page mutates its own tree while the sweep is measuring it. The serialized tree
  // is roles-only, so a changed entity COUNT (list/listitem, row/cell) is indistin-
  // guishable from a hand-authored landmark change — an exact frozen ariaSnapshot is
  // the wrong instrument here, and re-freezing it only moves the next false failure
  // to the next run.
  //
  // Remove alongside the two above once the fixture pins the clock and isolates
  // platform state (BI-0C6C2153).
  "/platform/ai/operations-map": "wall-clock-collection",
  // /platform/ai/right-now (BI-1A68257F) is the same class as operations-map: its
  // loader reads the live orchestration set (working TaskRuns, today's
  // ToolExecutions, TokenUsage) that concurrent sessions and crons mutate; it
  // derives "quiet Nd" and last-acted labels from the wall clock; and its
  // WorkforceNowShell re-fetches on a 12s timer, mutating its own roles-only tree
  // while the sweep measures it. An exact frozen ariaSnapshot is the wrong
  // instrument here for the identical reasons. Remove alongside the others once
  // the fixture pins the clock and isolates platform state (BI-0C6C2153).
  "/platform/ai/right-now": "wall-clock-collection",
  // /ops/teardown reads the surviving host evidence journal on arrival. A teardown
  // sibling can append or terminalize that collection while an unrelated route sweep
  // is running, so its roles-only snapshot is not stable under concurrent operations.
  // Measure it in the governed teardown journey; re-include it once the sweep owns an
  // isolated evidence directory.
  "/ops/teardown": "wall-clock-collection",
} as const satisfies Record<string, RouteSweepExclusionReason>;

export type RouteShellPolicy = {
  routePath: string;
  shell: UxShell;
  /**
   * Who the route is for. Carried here so the sweep can resolve the reading tier
   * without a second registry lookup (BI-1DE6F69E) — the shell alone cannot say
   * whether a surface is operator-facing.
   */
  audience: RouteAudience;
  /** True once the route has adopted its L1 shell. */
  migrated: boolean;
  /** Checks waived while the route is pre-migration — recorded baseline debt. */
  exemptChecks: readonly ExemptCheck[];
  /** Whether the generic owner fixture can measure this route honestly. */
  sweepEligible: boolean;
  /** Why the route remains in inventory but outside this fixture context. */
  sweepExclusionReason?: RouteSweepExclusionReason;
};

/**
 * Where the sweep fixture publishes the concrete paths it minted for dynamic
 * routes. Repo-relative so the fixture (cwd apps/web) and the sweep (cwd repo
 * root) name the same file.
 */
export const SWEEP_ROUTE_PARAMS_REL = "apps/web/test-results/ux-route-sweep/route-params.json";

/**
 * BI-DE67A3EC — dynamic routes the sweep fixture can resolve to a real path.
 *
 * Every route with a `[param]` used to be excluded outright, because nothing
 * produced an id to substitute. That excluded 87 routes, 53 of them owner-facing
 * — the DETAIL surfaces where an operator reads state and acts, which is exactly
 * where a word or field budget matters most. A gate that measures only list
 * pages reports a green it has not earned.
 *
 * A route earns a place here only once the fixture mints a deterministic row for
 * it. Listing one the fixture does not mint makes the sweep fail loudly rather
 * than measure the literal "[param]" path — see resolveSweepPath in the runner.
 */
export const SWEEP_RESOLVABLE_DYNAMIC_ROUTES: readonly string[] = [
  "/workspace/cases/[caseKey]",
];

export function shellPolicyFor(routePath: string, c: ShellClassifiable): RouteShellPolicy {
  const migrated = MIGRATED_ROUTES.has(routePath);
  const sweepExclusionReason =
    routePath.includes("[") && !SWEEP_RESOLVABLE_DYNAMIC_ROUTES.includes(routePath)
      ? "dynamic-fixture-required"
      : ROUTE_SWEEP_EXCLUSIONS[routePath as keyof typeof ROUTE_SWEEP_EXCLUSIONS];
  return {
    routePath,
    shell: shellForRoute(c),
    audience: c.audience,
    migrated,
    exemptChecks: migrated ? [] : PRE_MIGRATION_EXEMPT_CHECKS,
    sweepEligible: sweepExclusionReason === undefined,
    ...(sweepExclusionReason ? { sweepExclusionReason } : {}),
  };
}
