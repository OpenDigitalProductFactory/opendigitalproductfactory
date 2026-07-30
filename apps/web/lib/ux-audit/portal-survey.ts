// Portal Survey Orchestrator — core (EP-UX-AUDITOR Phase 1, BI-A01DC56C).
// Spec: docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md
// Plan: docs/superpowers/plans/2026-07-16-ux-auditor-portal-survey.md
//
// The missing piece the substrate map identified: an orchestrator that walks the
// route set, runs per-route evaluators, and aggregates their findings into ONE
// portal report with per-route + portal verdicts. This module is the pure,
// unit-testable core — evaluators are INJECTED (an interface), so the real
// evaluate_page (browser-use + axe) and askCoworker behavioral wiring land in
// Phase 2 (BI-C3768478) without changing this logic.
//
// Reuse, not reinvention: UxFinding is the shipped finding shape
// (apps/web/lib/tak/page-evaluator.ts); the route manifest
// (apps/web/lib/ea/route-manifest.json) is the enumeration source. Per spec §0.2
// the per-finding severity vocabulary is critical|important|minor and the
// per-route VERDICT vocabulary is pass|pass-with-minor|concerns|fail — distinct
// axes, rolled up here.

import type { UxFinding } from "@/lib/tak/page-evaluator";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  summarisePurposeCoverage,
  type PurposeCoverageSummary,
  type RoutePurposeEvaluation,
} from "@/lib/ux-budget/purpose-evaluator";

// Re-exported so consumers (and tests) can take the finding shape from the
// survey module without reaching into page-evaluator directly.
export type { UxFinding };

/** One entry from apps/web/lib/ea/route-manifest.json. */
export type RouteManifestEntry = {
  routePath: string;
  kind: "page" | "route";
  segments: string[];
  dynamicParams: string[];
  file: string;
  redirectTo?: string;
};

export type RouteManifest = {
  generator?: string;
  routeCount?: number;
  routes: RouteManifestEntry[];
};

/** Per-route / portal verdict — distinct from per-finding severity (spec §0.2). */
export type SurveyVerdict = "pass" | "pass-with-minor" | "concerns" | "fail";

/**
 * A finding as it appears in the aggregated report: the shipped UxFinding plus
 * the route it was found on and, additively (spec §5.3), which lens/agent
 * produced it. `category` stays; `lens`/`agentId` are optional overlays.
 */
export type AuditFinding = UxFinding & {
  route: string;
  lens?: string;
  agentId?: string;
};

/** Whether a lens evaluates the static page or drives an interactive behavior. */
export type LensMode = "page" | "behavioral";

export type LensSpec = {
  id: string;
  mode: LensMode;
  description: string;
};

/**
 * The coworker button-decision lens (validates BI-3237B5D6 + the P1.5 prose
 * fallback INSIDE the survey). Defined here; executed by the behavioral
 * evaluator wired in Phase 2 — drive a coworker to a proceed/choice closeout
 * and assert the recommended-first decision buttons render.
 */
export const BUTTON_DECISION_LENS: LensSpec = {
  id: "coworker-button-decision",
  mode: "behavioral",
  description:
    "Drive the route's coworker to a next-step decision (a proceed or A/B closeout) and assert clickable, recommended-first decision buttons render instead of a free-text 'type your reply' prompt.",
};

export type SurveyPlanEntry = {
  route: string;
  /** Lens ids assigned to this route. */
  lenses: string[];
};

export type SurveyPlan = {
  entries: SurveyPlanEntry[];
  /** Routes considered but dropped, with why — surfaced so coverage is honest. */
  skipped: Array<{ route: string; reason: string }>;
};

export type PlanOptions = {
  lenses: LensSpec[];
  /** Extra predicate to include a route (after the built-in surveyable filter). */
  include?: (entry: RouteManifestEntry) => boolean;
  /** Cap the plan to the first N surveyable routes (stable routePath order). 0/undefined = all. */
  sample?: number;
  /** Which routes host a coworker → get behavioral lenses. Defaults to none. */
  coworkerRoute?: (routePath: string) => boolean;
  /** Include redirect routes (default false — the redirect target is surveyed on its own entry). */
  includeRedirects?: boolean;
};

export type RouteSurveyResult = {
  route: string;
  verdict: SurveyVerdict;
  findings: AuditFinding[];
  /** Which lens modes actually ran (an evaluator may be absent). */
  evaluated: { page: boolean; behavioral: boolean };
  purpose?: RoutePurposeEvaluation;
  /** Present when an evaluator threw — the route is reported, not silently dropped. */
  error?: string;
};

export type FindingCounts = { critical: number; important: number; minor: number };

export type UxAuditReport = {
  routeCount: number;
  evaluatedRouteCount: number;
  portalVerdict: SurveyVerdict;
  verdictCounts: Record<SurveyVerdict, number>;
  findingCounts: FindingCounts;
  purposeCoverage: PurposeCoverageSummary;
  routes: RouteSurveyResult[];
};

/** Injected evaluators — the seam that keeps this core pure + testable. */
export type PageLensEvaluator = (route: string) => Promise<UxFinding[]>;
export type BehavioralLensEvaluator = (
  route: string,
  lens: LensSpec,
) => Promise<UxFinding[]>;
export type PurposeLensEvaluator = (
  route: string,
) => Promise<RoutePurposeEvaluation | undefined>;
export type SpecialPurposeEvaluator = {
  routePaths: readonly string[];
  evaluate: (routePath: string) => Promise<RoutePurposeEvaluation>;
};

export type SurveyEvaluators = {
  page?: PageLensEvaluator;
  behavioral?: BehavioralLensEvaluator;
  purpose?: PurposeLensEvaluator;
  specialPurpose?: SpecialPurposeEvaluator;
};

const VERDICT_ORDER: SurveyVerdict[] = ["pass", "pass-with-minor", "concerns", "fail"];

/**
 * A route is surveyable if it renders a page a user can visit: page kind, no
 * dynamic params (can't be visited without concrete values in P1), and — unless
 * asked — not a bare redirect (its target is surveyed on that target's entry).
 */
export function isSurveyable(
  entry: RouteManifestEntry,
  opts: { includeRedirects?: boolean } = {},
): boolean {
  if (entry.kind !== "page") return false;
  if (entry.dynamicParams.length > 0) return false;
  if (!opts.includeRedirects && entry.redirectTo) return false;
  return true;
}

/** Map a set of findings to a route verdict (worst severity wins). */
export function verdictForFindings(findings: Pick<UxFinding, "severity">[]): SurveyVerdict {
  let worst: SurveyVerdict = "pass";
  for (const f of findings) {
    if (f.severity === "critical") return "fail";
    if (f.severity === "important") worst = maxVerdict(worst, "concerns");
    else if (f.severity === "minor") worst = maxVerdict(worst, "pass-with-minor");
  }
  return worst;
}

function maxVerdict(a: SurveyVerdict, b: SurveyVerdict): SurveyVerdict {
  return VERDICT_ORDER.indexOf(a) >= VERDICT_ORDER.indexOf(b) ? a : b;
}

function verdictForPurpose(
  purpose: RoutePurposeEvaluation | undefined,
): SurveyVerdict {
  if (!purpose) return "pass";
  if (purpose.validation.overall === "failed") return "fail";
  if (purpose.structuralStatus === "nonconformant") return "concerns";
  if (
    purpose.intentStatus !== "intent-ratified" ||
    purpose.structuralStatus === "not-evaluated" ||
    purpose.validation.overall !== "current"
  ) {
    return "pass-with-minor";
  }
  return "pass";
}

/**
 * Plan a survey: filter the manifest to surveyable routes, sort by routePath for
 * determinism, optionally sample the first N, and assign lenses — page lenses to
 * every route, behavioral lenses only to coworker-bearing routes.
 */
export function planSurvey(manifest: RouteManifest, options: PlanOptions): SurveyPlan {
  const entries: SurveyPlanEntry[] = [];
  const skipped: SurveyPlan["skipped"] = [];

  const pageLenses = options.lenses.filter((l) => l.mode === "page").map((l) => l.id);
  const behavioralLenses = options.lenses.filter((l) => l.mode === "behavioral").map((l) => l.id);

  const surveyable = [...manifest.routes]
    .sort((a, b) => a.routePath.localeCompare(b.routePath))
    .filter((entry) => {
      if (!isSurveyable(entry, { includeRedirects: options.includeRedirects })) {
        skipped.push({ route: entry.routePath, reason: unsurveyableReason(entry, options) });
        return false;
      }
      if (options.include && !options.include(entry)) {
        skipped.push({ route: entry.routePath, reason: "excluded by include predicate" });
        return false;
      }
      return true;
    });

  const capped =
    options.sample && options.sample > 0 ? surveyable.slice(0, options.sample) : surveyable;

  for (const entry of surveyable.slice(capped.length)) {
    skipped.push({ route: entry.routePath, reason: `beyond sample cap (${options.sample})` });
  }

  for (const entry of capped) {
    const lenses = [...pageLenses];
    if (options.coworkerRoute?.(entry.routePath)) lenses.push(...behavioralLenses);
    entries.push({ route: entry.routePath, lenses });
  }

  return { entries, skipped };
}

function unsurveyableReason(entry: RouteManifestEntry, options: PlanOptions): string {
  if (entry.kind !== "page") return "not a page route (API/handler)";
  if (entry.dynamicParams.length > 0) return `dynamic params (${entry.dynamicParams.join(",")})`;
  if (!options.includeRedirects && entry.redirectTo) return `redirect → ${entry.redirectTo}`;
  return "not surveyable";
}

/** De-duplicate findings within a route by (element, category, lens) — spec Q9 join key. */
export function dedupeFindings(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  const out: AuditFinding[] = [];
  for (const f of findings) {
    const key = `${f.route}::${f.element}::${f.category}::${f.lens ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Fold per-route results into one portal report. */
export function aggregateReport(routes: RouteSurveyResult[]): UxAuditReport {
  const verdictCounts: Record<SurveyVerdict, number> = {
    pass: 0,
    "pass-with-minor": 0,
    concerns: 0,
    fail: 0,
  };
  const findingCounts: FindingCounts = { critical: 0, important: 0, minor: 0 };
  let portalVerdict: SurveyVerdict = "pass";
  let evaluatedRouteCount = 0;

  for (const r of routes) {
    verdictCounts[r.verdict] += 1;
    portalVerdict = maxVerdict(portalVerdict, r.verdict);
    if (r.evaluated.page || r.evaluated.behavioral || r.purpose) {
      evaluatedRouteCount += 1;
    }
    for (const f of r.findings) findingCounts[f.severity] += 1;
  }

  return {
    routeCount: routes.length,
    evaluatedRouteCount,
    portalVerdict,
    verdictCounts,
    findingCounts,
    purposeCoverage: summarisePurposeCoverage(
      routes.flatMap((route) => (route.purpose ? [route.purpose] : [])),
    ),
    routes,
  };
}

/**
 * Run a planned survey with the injected evaluators and aggregate the report.
 * Sequential + deterministic for P1 (bounded concurrency is a Phase-2 concern).
 * A thrown evaluator degrades that route to an error entry — it never aborts the
 * whole survey. A route whose evaluator is absent simply doesn't run that lens.
 */
export async function runSurvey(
  plan: SurveyPlan,
  evaluators: SurveyEvaluators,
  lensById: Map<string, LensSpec>,
): Promise<UxAuditReport> {
  const results: RouteSurveyResult[] = [];

  for (const entry of plan.entries) {
    const findings: AuditFinding[] = [];
    const evaluated = { page: false, behavioral: false };
    let error: string | undefined;
    let purpose: RoutePurposeEvaluation | undefined;

    const hasPageLens = entry.lenses.some((id) => lensById.get(id)?.mode === "page");
    const behavioralLenses = entry.lenses
      .map((id) => lensById.get(id))
      .filter((l): l is LensSpec => l?.mode === "behavioral");

    try {
      if (hasPageLens && evaluators.page) {
        const pageFindings = await evaluators.page(entry.route);
        for (const f of pageFindings) findings.push({ ...f, route: entry.route, lens: "page" });
        evaluated.page = true;
      }
      for (const lens of behavioralLenses) {
        if (!evaluators.behavioral) break;
        const behFindings = await evaluators.behavioral(entry.route, lens);
        for (const f of behFindings) {
          findings.push({ ...f, route: entry.route, lens: lens.id });
        }
        evaluated.behavioral = true;
      }
      if (evaluators.purpose) {
        purpose = await evaluators.purpose(entry.route);
      }
    } catch (e) {
      error = getErrorMessage(e);
    }

    const deduped = dedupeFindings(findings);
    results.push({
      route: entry.route,
      verdict: error
        ? "concerns"
        : maxVerdict(
            verdictForFindings(deduped),
            verdictForPurpose(purpose),
          ),
      findings: deduped,
      evaluated,
      ...(purpose ? { purpose } : {}),
      ...(error ? { error } : {}),
    });
  }

  if (evaluators.specialPurpose) {
    const existingRoutes = new Set(results.map((result) => result.route));
    for (const routePath of evaluators.specialPurpose.routePaths) {
      if (existingRoutes.has(routePath)) continue;
      try {
        const purpose = await evaluators.specialPurpose.evaluate(routePath);
        results.push({
          route: purpose.routePath,
          verdict: verdictForPurpose(purpose),
          findings: [],
          evaluated: { page: false, behavioral: false },
          purpose,
        });
      } catch (error) {
        results.push({
          route: routePath,
          verdict: "concerns",
          findings: [],
          evaluated: { page: false, behavioral: false },
          error: getErrorMessage(error),
        });
      }
      existingRoutes.add(routePath);
    }
  }

  return aggregateReport(results);
}
