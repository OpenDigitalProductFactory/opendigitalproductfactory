// apps/web/lib/governance/finding-contract.ts — EP-8DC217EB BET-12
//
// One presentational contract for the four governance finding streams that
// never met — wiki lint, decision review, assurance (supply-chain), and
// security (SOC) cases. Each stream keeps its own model and persistence; this
// is the shared read-shape a unified findings surface (and BI-83AC1A03's
// reporting composer) projects them into, plus the adapters that fold each
// source type onto it.
//
// Purely additive: the four `from*` adapters read the existing source types
// and produce a GovernanceFinding. No source model, detector, or persistence
// path changes here — that sequencing is the later BET-12 increment (the
// reconcile-keyed-findings extraction and detector→ingestBacklogItem fan-in).

import {
  fromLadderString,
  fromLintSeverity,
  type GovernanceSeverity,
  compareSeverity,
  highestSeverity,
} from "./severity";

export interface GovernanceFindingAction {
  kind: "navigate" | "execute";
  label: string;
  href: string;
  outcome: string;
}

/** Which stream produced a finding. */
export const GOVERNANCE_FINDING_SOURCES = [
  "wiki-lint",
  "decision-review",
  "assurance",
  "security",
] as const;
export type GovernanceFindingSource = (typeof GOVERNANCE_FINDING_SOURCES)[number];

/** The unified read-shape every finding surface renders. */
export interface GovernanceFinding {
  /** Stream that produced it. */
  source: GovernanceFindingSource;
  /** Stable per-source key (findingKind / findingClass id / findingKey / caseKey). */
  key: string;
  severity: GovernanceSeverity;
  /** The source stream's own status verb, verbatim (not normalized). */
  status: string;
  title: string;
  /** Human detail; source details are coerced to a string for the shared shape. */
  detail: string;
  /** How many underlying items this rolls up (gap clusters, case detections). */
  count: number;
  /** Read-only detail destination, when applicable. */
  detailHref?: string | null;
  /** A complete, outcome-bearing action; null means the adapter failed closed. */
  action?: GovernanceFindingAction | null;
}

// ── Narrow source views (structural — avoid importing the whole source modules,
//    which drag persistence/detector deps). Each mirrors the fields the adapter
//    reads from the real type. ────────────────────────────────────────────────

export interface LintFindingView {
  pageId: string;
  findingKind: string;
  severity: "info" | "warn" | "error";
  detail: Record<string, unknown>;
}

export interface ReviewFindingView {
  id: string;
  findingClass: "conflict" | "gap" | "staleness" | "drift" | "weight-proposal";
  title: string;
  detail: string;
  count: number;
  detailHref: string | null;
  action?: GovernanceFindingAction;
}

export interface AssuranceFindingView {
  findingKey: string;
  title: string;
  description?: string;
  policySeverity: string; // AssurancePolicySeverity — already the canonical ladder
  status: string;
}

export interface SecurityCaseView {
  caseKey: string;
  title: string;
  severity: string; // CaseSeverity — info|low|medium|high|critical
  status: string;
  detectionCount?: number;
  href?: string | null;
}

/** decision-review has no severity axis — fold its findingClass onto the ladder. */
function reviewClassSeverity(findingClass: ReviewFindingView["findingClass"]): GovernanceSeverity {
  switch (findingClass) {
    case "conflict":
      return "high";
    case "staleness":
    case "drift":
      return "medium";
    default:
      return "low"; // gap
  }
}

function completeAction(action: GovernanceFindingAction | undefined): GovernanceFindingAction | null {
  if (!action) return null;
  return action.label.trim() && action.href.trim() && action.outcome.trim() ? action : null;
}

export function fromLintFinding(finding: LintFindingView): GovernanceFinding {
  return {
    source: "wiki-lint",
    key: `${finding.pageId}:${finding.findingKind}`,
    severity: fromLintSeverity(finding.severity),
    status: "open",
    title: finding.findingKind,
    detail: JSON.stringify(finding.detail),
    count: 1,
  };
}

export function fromReviewFinding(finding: ReviewFindingView): GovernanceFinding {
  return {
    source: "decision-review",
    key: finding.id,
    severity: reviewClassSeverity(finding.findingClass),
    status: finding.findingClass, // conflict|gap|staleness — its own state axis
    title: finding.title,
    detail: finding.detail,
    count: finding.count,
    detailHref: finding.detailHref,
    action: completeAction(finding.action),
  };
}

export function fromAssuranceFinding(finding: AssuranceFindingView): GovernanceFinding {
  return {
    source: "assurance",
    key: finding.findingKey,
    severity: fromLadderString(finding.policySeverity),
    status: finding.status,
    title: finding.title,
    detail: finding.description ?? "",
    count: 1,
  };
}

export function fromSecurityCase(view: SecurityCaseView): GovernanceFinding {
  return {
    source: "security",
    key: view.caseKey,
    severity: fromLadderString(view.severity),
    status: view.status,
    title: view.title,
    detail: "",
    count: view.detectionCount ?? 1,
    detailHref: view.href ?? null,
  };
}

/** Sort a mixed finding set most-severe-first (stable within a severity). */
export function sortFindingsBySeverity(findings: GovernanceFinding[]): GovernanceFinding[] {
  return [...findings].sort((a, b) => compareSeverity(b.severity, a.severity));
}

export interface GovernanceFindingRollup {
  total: number;
  bySeverity: Record<GovernanceSeverity, number>;
  bySource: Record<GovernanceFindingSource, number>;
  /** The most severe severity present; `info` when empty. */
  worst: GovernanceSeverity;
}

/** Roll a mixed finding set up for a badge/summary surface. */
export function rollupFindings(findings: GovernanceFinding[]): GovernanceFindingRollup {
  const bySeverity: Record<GovernanceSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const bySource: Record<GovernanceFindingSource, number> = {
    "wiki-lint": 0,
    "decision-review": 0,
    assurance: 0,
    security: 0,
  };
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    bySource[f.source] += 1;
  }
  return {
    total: findings.length,
    bySeverity,
    bySource,
    worst: highestSeverity(findings.map((f) => f.severity)),
  };
}
