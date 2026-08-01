// apps/web/lib/ux-budget/evaluate.ts
//
// Budget evaluation — EP-UX-SYSTEM spec §6 L2 / §8 (BI-B9BE9A29).
//
// Produces one finding per axis. Severity depends on BOTH the axis and the age of the
// route, per spec rev 2 (§6 L4 decision D1, PR #3434):
//
//   "blocking" always — checks with no calibration ambiguity: sub-legible controls
//                 violate WCAG 2.2 AA 2.5.8, and a long AND undifferentiated surface is
//                 a regression wherever the exact line sits.
//   "blocking" on NET-NEW routes — the absolute text budgets. A pure ratchet freezes
//                 whatever ships first, so a route created after Phase 1 would become
//                 its own baseline and could be born as a wall of text without ever
//                 failing. Legacy debt earns a ratchet; new code has no legacy excuse.
//   "advisory" on PRE-EXISTING routes — the same absolute budgets, reported on the PR.
//                 Text-mass thresholds remain platform-owned calibration (no surviving
//                 evidence validates words-per-screen against user outcomes), so
//                 RETROFITTING them onto existing routes keeps the §8 flip contract.
//
// The route sweep (BI-BD81682A) adds the axis this module cannot see on its own: the
// REGRESSION RATCHET, comparing a changed route against its own frozen baseline.
//
// CALIBRATION STATUS: spec rev 2 sets the day-one absolute at the measured median of
// compliant routes, which requires the §7.1 baseline sweep that does not exist yet.
// The numbers in budgets.ts are therefore provisional; what lands here is the
// MECHANISM that lets them bite the moment the sweep supplies real medians.

import type { UxBudget, UxShell } from "./budgets";
import { budgetFor } from "./budgets";
import { meetsReadingLevel, type UxBudgetMetrics } from "./measure";
import type { ExemptCheck } from "./route-shells";
import type { RouteAudience } from "../navigation/route-audience";

export type BudgetSeverity = "advisory" | "blocking";

/**
 * Whether the route existed before the budget regime. Net-new routes get the
 * absolute budgets as blocking gates (spec rev 2 D1); pre-existing routes get them
 * as advisory reports plus the sweep's ratchet.
 */
export type RouteStatus = "net-new" | "pre-existing";

export type BudgetFinding = {
  check: string;
  ok: boolean;
  severity: BudgetSeverity;
  detail: string;
  /** True when the check was waived because the route is pre-migration. */
  exempt?: boolean;
};

export type BudgetReport = {
  shell: UxShell;
  routeStatus: RouteStatus;
  metrics: UxBudgetMetrics;
  findings: BudgetFinding[];
  /** True when no BLOCKING finding failed. Advisory failures never set this false. */
  ok: boolean;
  advisoryFailures: number;
};

/** Absolute text-mass budgets: advisory when retrofitted, blocking when born new. */
const ABSOLUTE_TEXT_CHECKS = new Set([
  "default-visible-words",
  "lead-band",
  "lead-band-words",
  "primary-actions",
  "visible-fields",
  "choices-per-control",
  "reading-level",
  "next-action-marker",
]);

function within(actual: number, max: number): boolean {
  return actual <= max;
}

export function evaluateUxBudget(
  metrics: UxBudgetMetrics,
  shell: UxShell,
  options: {
    exemptChecks?: readonly ExemptCheck[];
    routeStatus?: RouteStatus;
    /** Route audience — loosens the reading tier for operator surfaces (BI-1DE6F69E). */
    audience?: RouteAudience | null;
  } = {},
): BudgetReport {
  const budget: UxBudget = budgetFor(shell, options.audience);
  const routeStatus: RouteStatus = options.routeStatus ?? "pre-existing";
  // A net-new route cannot claim pre-migration debt it never accrued.
  const exempt = new Set<string>(routeStatus === "net-new" ? [] : (options.exemptChecks ?? []));

  const raw: BudgetFinding[] = [
    {
      check: "default-visible-words",
      ok: within(metrics.defaultVisibleWords, budget.maxDefaultVisibleWords),
      severity: "advisory",
      detail: `${metrics.defaultVisibleWords} words visible on arrival (budget ${budget.maxDefaultVisibleWords}; collapsed disclosure excised)`,
    },
    {
      check: "lead-band",
      ok: budget.requireLeadBand ? metrics.hasLeadBand : true,
      severity: "advisory",
      detail: metrics.hasLeadBand
        ? "lead band present"
        : "no data-dpf-lead band — the owner has no marked place to start",
    },
    {
      check: "lead-band-words",
      ok: !metrics.hasLeadBand || within(metrics.leadBandWords, budget.maxLeadBandWords),
      severity: "advisory",
      detail: `${metrics.leadBandWords} words in the lead band (budget ${budget.maxLeadBandWords})`,
    },
    {
      check: "primary-actions",
      ok: within(metrics.primaryActions, budget.maxPrimaryActions),
      severity: "advisory",
      detail: `${metrics.primaryActions} primary actions (budget ${budget.maxPrimaryActions})`,
    },
    {
      check: "visible-fields",
      ok: within(metrics.visibleFields, budget.maxVisibleFields),
      severity: "advisory",
      detail: `${metrics.visibleFields} fields visible at once (budget ${budget.maxVisibleFields})`,
    },
    {
      check: "choices-per-control",
      ok: within(metrics.maxChoicesPerControl, budget.maxChoicesPerControl),
      severity: "advisory",
      detail: `largest control offers ${metrics.maxChoicesPerControl} choices (budget ${budget.maxChoicesPerControl})`,
    },
    {
      // WCAG 2.2 AA 2.5.8 — not calibration, a standard.
      check: "sub-legible-controls",
      ok: within(metrics.subLegibleControls, budget.maxSubLegibleControls),
      severity: "blocking",
      detail: `${metrics.subLegibleControls} sub-legible/sub-tappable controls (max ${budget.maxSubLegibleControls})`,
    },
    {
      // The anti-wall-of-text rule: long is allowed, long AND undifferentiated is not.
      check: "deferred-detail",
      ok:
        metrics.defaultVisibleWords <= budget.deferredDetailRequiredAboveWords ||
        metrics.disclosureRegions > 0,
      severity: "blocking",
      detail:
        metrics.defaultVisibleWords <= budget.deferredDetailRequiredAboveWords
          ? `${metrics.defaultVisibleWords} words — below the ${budget.deferredDetailRequiredAboveWords}-word deferral threshold`
          : `${metrics.defaultVisibleWords} words with ${metrics.disclosureRegions} disclosure regions — above ${budget.deferredDetailRequiredAboveWords} words the surface must defer detail`,
    },
    {
      check: "reading-level",
      ok: meetsReadingLevel(metrics, budget.readingLevel),
      severity: "advisory",
      detail: `grade ${metrics.readingGradeLevel} prose (tier: ${budget.readingLevel})`,
    },
    {
      check: "next-action-marker",
      ok: budget.requireNextActionMarker ? metrics.hasNextActionMarker : true,
      severity: "advisory",
      detail: metrics.hasNextActionMarker
        ? "owner-first next action present"
        : "no owner-first next action marker",
    },
    {
      // The self-upgrade lesson (BI-D77BF495): a primary action hidden behind a
      // collapsed disclosure is a findability regression the word budgets cannot
      // see — hiding it makes the counts LOOK better. This is blocking on net-new
      // routes; on pre-existing routes the ratchet's buriedPrimaryAction axis
      // catches the 0→1 transition (newly buried), so an already-buried legacy
      // route does not fail an unrelated PR.
      check: "primary-action-reachable",
      ok: budget.requirePrimaryActionReachable ? metrics.buriedPrimaryAction === 0 : true,
      severity: "blocking",
      detail:
        metrics.buriedPrimaryAction === 0
          ? "primary action reachable on arrival"
          : "primary action is marked but buried behind a collapsed disclosure — not visible on arrival",
    },
  ];

  const findings = raw
    .map((f) =>
      // D1: on a net-new route the absolute text budgets stop being suggestions.
      routeStatus === "net-new" && ABSOLUTE_TEXT_CHECKS.has(f.check)
        ? { ...f, severity: "blocking" as BudgetSeverity }
        : f,
    )
    .map((f) =>
      exempt.has(f.check) && !f.ok
        ? { ...f, ok: true, exempt: true, detail: `${f.detail} — exempt (pre-migration baseline debt)` }
        : f,
    );

  return {
    shell,
    routeStatus,
    metrics,
    findings,
    ok: findings.every((f) => f.ok || f.severity !== "blocking"),
    advisoryFailures: findings.filter((f) => !f.ok && f.severity === "advisory").length,
  };
}
