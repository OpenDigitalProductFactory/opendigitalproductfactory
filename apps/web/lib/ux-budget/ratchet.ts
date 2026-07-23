// apps/web/lib/ux-budget/ratchet.ts
//
// The wall-of-text gate — EP-UX-SYSTEM spec §6 L4 (BI-BD81682A), incorporating rev 2
// decisions D1 (net-new absolutes) and D2 (structural hierarchy snapshot).
//
// This is the module that answers "every iteration adds more wall of text". It is pure
// and DOM-free on purpose: the Playwright driver (scripts/ux-route-sweep.ts) does the
// measuring, this decides the verdict, and the verdict logic is unit-testable without a
// browser, a database or a build.
//
// THREE ENFORCEMENT MODES, by route:
//
//   1. PRE-EXISTING route  → REGRESSION RATCHET, blocking. A changed route may not
//      exceed its own frozen baseline on any axis. No calibration needed: adding 400
//      words to a cockpit is a regression regardless of where the "right" number sits.
//      Its absolute budgets stay advisory (the §8 flip contract governs retrofit).
//   2. NET-NEW route → ABSOLUTE BUDGETS, blocking (rev 2 D1). A pure ratchet freezes
//      whatever ships first, so without this a brand-new route becomes its own baseline
//      and can be born as a wall of text without ever failing. New code has no legacy
//      excuse.
//   3. STRUCTURE → the ARIA snapshot must not drift (rev 2 D2). Hierarchy is the
//      dominant AI failure mode per the cited research and was previously unmeasured;
//      the snapshot is deterministic and diffable, so it ratchets like the numbers do.
//
// BOOTSTRAP HONESTY: a ratchet needs a baseline, and the baseline can only come from
// measuring a running portal (spec §7.1 step 1 — the league table precedes migration).
// Until that measured baseline is committed, `bootstrapped` is false and the sweep
// REPORTS without blocking. That is a single mechanical step, not a calibration debate
// or an open-ended "advisory for now" hedge — and while it is false the sweep says so
// loudly rather than passing quietly.

import { evaluateUxBudget, type BudgetFinding, type RouteStatus } from "./evaluate";
import type { UxBudgetMetrics } from "./measure";
import type { UxShell } from "./budgets";
import type { ExemptCheck } from "./route-shells";

/** What the sweep measured for one route. */
export type RouteMeasurement = {
  routePath: string;
  shell: UxShell;
  metrics: UxBudgetMetrics;
  /** YAML accessibility-tree projection (roles, heading levels, names). */
  ariaSnapshot: string;
  /** Serious/critical axe violations. Necessary, never sufficient. */
  axeViolations: number;
  exemptChecks?: readonly ExemptCheck[];
};

/** The frozen per-route baseline a changed route is measured against. */
export type RouteBaseline = {
  defaultVisibleWords: number;
  leadBandWords: number;
  primaryActions: number;
  visibleFields: number;
  maxChoicesPerControl: number;
  subLegibleControls: number;
  buriedPrimaryAction: number;
  axeViolations: number;
  ariaSnapshot: string;
};

export type BaselineFile = {
  /** False until a measured baseline has been committed; the sweep reports only. */
  bootstrapped: boolean;
  generator: string;
  routes: Record<string, RouteBaseline>;
};

/** Axes where MORE is a regression. Ordered for a readable report. */
export const RATCHET_AXES = [
  "defaultVisibleWords",
  "leadBandWords",
  "primaryActions",
  "visibleFields",
  "maxChoicesPerControl",
  "subLegibleControls",
  "buriedPrimaryAction",
  "axeViolations",
] as const;
export type RatchetAxis = (typeof RATCHET_AXES)[number];

const AXIS_LABEL: Record<RatchetAxis, string> = {
  defaultVisibleWords: "words visible on arrival",
  leadBandWords: "lead-band words",
  primaryActions: "primary actions",
  visibleFields: "visible fields",
  maxChoicesPerControl: "choices in one control",
  subLegibleControls: "sub-legible controls",
  buriedPrimaryAction: "buried primary action (was reachable, now behind a collapse)",
  axeViolations: "axe violations",
};

export type RouteVerdict = {
  routePath: string;
  shell: UxShell;
  routeStatus: RouteStatus;
  /** Blocking regressions against the frozen baseline. */
  regressions: string[];
  /** Blocking absolute-budget failures (net-new routes only). */
  blockingBudgetFailures: string[];
  /** Advisory budget failures — reported, never blocking. */
  advisoryBudgetFailures: string[];
  /** True when the accessibility tree changed shape. */
  structureChanged: boolean;
  ok: boolean;
  findings: BudgetFinding[];
  metrics: UxBudgetMetrics;
};

function measurementValue(m: RouteMeasurement, axis: RatchetAxis): number {
  return axis === "axeViolations" ? m.axeViolations : m.metrics[axis];
}

/** Compare one route against its baseline (or judge it as net-new). */
export function verdictForRoute(
  measurement: RouteMeasurement,
  baseline: RouteBaseline | undefined,
): RouteVerdict {
  const routeStatus: RouteStatus = baseline ? "pre-existing" : "net-new";
  const report = evaluateUxBudget(measurement.metrics, measurement.shell, {
    routeStatus,
    exemptChecks: measurement.exemptChecks,
  });

  const regressions: string[] = [];
  let structureChanged = false;

  if (baseline) {
    for (const axis of RATCHET_AXES) {
      const now = measurementValue(measurement, axis);
      const was = baseline[axis];
      // A negative value means the measurement was UNAVAILABLE this run (e.g. the axe
      // scan threw). Comparing it would manufacture a phantom regression the next time
      // the scan works — 0 > -1 is not an increase in violations, it is a scan that
      // recovered. Skip the axis and let the run that measured it decide.
      if (now < 0 || was < 0) continue;
      if (now > was) {
        regressions.push(`${AXIS_LABEL[axis]}: ${was} → ${now}`);
      }
    }
    // Whitespace-only reformatting of the YAML projection is not a hierarchy change.
    structureChanged = normaliseSnapshot(measurement.ariaSnapshot) !== normaliseSnapshot(baseline.ariaSnapshot);
  }

  const failed = report.findings.filter((f) => !f.ok);

  // On a PRE-EXISTING route the ratchet is the enforcement, and nothing else blocks.
  //
  // This is not a softening — it is what makes the gate adoptable. Legacy surfaces
  // already violate absolute budgets (the audit found an 818-word page with 34
  // sub-legible controls). If those absolutes blocked on a route the PR did not make
  // worse, every unrelated PR would fail until someone rewrote the whole portal —
  // the blind mass-rewrite the ratchet exists to avoid, and the fastest way to get a
  // required check disabled. Existing debt is reported every run and is caught the
  // moment it GROWS, because subLegibleControls and the rest are ratchet axes.
  // A net-new route has no such history, so on it every budget blocks.
  const blockingBudgetFailures =
    routeStatus === "net-new" ? failed.filter((f) => f.severity === "blocking").map((f) => f.detail) : [];
  const advisoryBudgetFailures =
    routeStatus === "net-new"
      ? failed.filter((f) => f.severity === "advisory").map((f) => f.detail)
      : failed.map((f) => f.detail);

  return {
    routePath: measurement.routePath,
    shell: measurement.shell,
    routeStatus,
    regressions,
    blockingBudgetFailures,
    advisoryBudgetFailures,
    structureChanged,
    ok: regressions.length === 0 && !structureChanged && blockingBudgetFailures.length === 0,
    findings: report.findings,
    metrics: measurement.metrics,
  };
}

export function normaliseSnapshot(snapshot: string): string {
  return snapshot
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .join("\n");
}

export type SweepVerdict = {
  bootstrapped: boolean;
  /** True when CI should fail. Always false while bootstrapping. */
  blocked: boolean;
  verdicts: RouteVerdict[];
  netNewRoutes: string[];
  regressedRoutes: string[];
  /** §7.1 league table: worst offenders first, by words then controls. */
  leagueTable: { routePath: string; shell: UxShell; words: number; controls: number }[];
};

export function evaluateSweep(
  measurements: RouteMeasurement[],
  baselineFile: BaselineFile,
): SweepVerdict {
  const verdicts = measurements.map((m) => verdictForRoute(m, baselineFile.routes[m.routePath]));

  const leagueTable = measurements
    .map((m) => ({
      routePath: m.routePath,
      shell: m.shell,
      words: m.metrics.defaultVisibleWords,
      controls: m.metrics.primaryActions + m.metrics.visibleFields,
    }))
    .sort((a, b) => b.words - a.words || b.controls - a.controls);

  return {
    bootstrapped: baselineFile.bootstrapped,
    // While bootstrapping the sweep's job is to PRODUCE the baseline, so it cannot
    // meaningfully judge against one. It reports; it does not block.
    blocked: baselineFile.bootstrapped && verdicts.some((v) => !v.ok),
    verdicts,
    netNewRoutes: verdicts.filter((v) => v.routeStatus === "net-new").map((v) => v.routePath),
    regressedRoutes: verdicts.filter((v) => v.regressions.length > 0).map((v) => v.routePath),
    leagueTable,
  };
}

/** Freeze the current measurements as the new baseline. */
export function freezeBaseline(measurements: RouteMeasurement[], generator: string): BaselineFile {
  const routes: Record<string, RouteBaseline> = {};
  for (const m of [...measurements].sort((a, b) => (a.routePath < b.routePath ? -1 : 1))) {
    routes[m.routePath] = {
      defaultVisibleWords: m.metrics.defaultVisibleWords,
      leadBandWords: m.metrics.leadBandWords,
      primaryActions: m.metrics.primaryActions,
      visibleFields: m.metrics.visibleFields,
      maxChoicesPerControl: m.metrics.maxChoicesPerControl,
      subLegibleControls: m.metrics.subLegibleControls,
      buriedPrimaryAction: m.metrics.buriedPrimaryAction,
      axeViolations: m.axeViolations,
      ariaSnapshot: normaliseSnapshot(m.ariaSnapshot),
    };
  }
  return { bootstrapped: true, generator, routes };
}

/** Human-readable summary for the CI log / PR comment. */
export function formatSweepReport(sweep: SweepVerdict): string {
  const lines: string[] = [];
  if (!sweep.bootstrapped) {
    lines.push(
      "UX route sweep — BOOTSTRAP MODE (reporting, not blocking).",
      "No measured baseline is committed yet, so there is nothing to ratchet against.",
      "Commit the baseline this run produced to arm the gate.",
      "",
    );
  }

  for (const v of sweep.verdicts.filter((x) => !x.ok)) {
    lines.push(`${v.routePath}  [${v.shell}, ${v.routeStatus}]`);
    for (const r of v.regressions) lines.push(`  REGRESSION  ${r}`);
    if (v.structureChanged) {
      lines.push("  REGRESSION  accessibility tree changed shape (heading/landmark structure)");
    }
    for (const f of v.blockingBudgetFailures) lines.push(`  BLOCKING    ${f}`);
    for (const f of v.advisoryBudgetFailures) lines.push(`  advisory    ${f}`);
    lines.push("");
  }

  lines.push("Worst surfaces by words visible on arrival (§7.1 league table):");
  for (const row of sweep.leagueTable.slice(0, 15)) {
    lines.push(`  ${String(row.words).padStart(5)}w  ${row.routePath}  [${row.shell}]`);
  }
  return lines.join("\n");
}
