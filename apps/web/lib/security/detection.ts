// EP-SOVEREIGN-SOC P1 — detection rule evaluation (pure, deterministic).
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.3, §7.1.
//
// Deterministic, explainable rules before ML/anomaly (§7.1). A DetectionRule's
// `predicate` (ruleFormat="dpf-correlation") is the small DSL below; the sweep
// evaluates enabled rules whose scope applies to each SecurityEvent and emits
// DetectionCandidate rows. Pure of Prisma — the sweep supplies rows + the
// threat-intel index.

import type { IndicatorIndex } from "./threat-intel";
import { matchIndicatorValues } from "./threat-intel";

/** The SecurityEvent fields the evaluator reads (persisted-row subset). */
export interface SecurityEventView {
  eventKey: string;
  ocsfClassUid: number;
  severityId: number | null;
  sourceKind: string;
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  time: Date;
  observables?: unknown;
  normalized?: unknown;
}

/** The dpf-correlation predicate DSL. Fields present on one node are ANDed;
 *  allOf/anyOf nest. Unknown shapes never throw — they simply do not match. */
export interface DetectionPredicate {
  classUid?: number;
  sourceKind?: string;
  minSeverityId?: number;
  /** Fire if any observable value is a known threat indicator. */
  matchThreatIndicator?: boolean;
  /** normalized.<dotted.path> strictly equals this value. */
  equals?: { path: string; value: string | number | boolean };
  allOf?: DetectionPredicate[];
  anyOf?: DetectionPredicate[];
}

export interface DetectionRuleView {
  id: string;
  ruleKey: string;
  name: string;
  severity: string;
  scopeKey: string;
  enabled: boolean;
  predicate: DetectionPredicate;
  mitreTechniques?: string[];
}

export interface EvaluationContext {
  indicatorIndex?: IndicatorIndex;
}

/** Shaped for the Detection model upsert. */
export interface DetectionCandidate {
  detectionKey: string;
  ruleId: string;
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  severity: string;
  riskScore: number;
  matchedEventRefs: string[];
  enrichment: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const SEVERITY_RISK: Record<string, number> = {
  info: 10,
  low: 30,
  medium: 50,
  high: 75,
  critical: 90,
};

function severityToRisk(severity: string): number {
  return SEVERITY_RISK[severity] ?? 40;
}

/** Read observable string values from an event view (Json-safe). */
export function eventObservableValues(event: SecurityEventView): string[] {
  const obs = event.observables;
  if (!Array.isArray(obs)) return [];
  const values: string[] = [];
  for (const o of obs) {
    const v = (o as { value?: unknown })?.value;
    if (typeof v === "string" && v.length) values.push(v);
  }
  return values;
}

/** Navigate a dotted path on a Json-ish object; undefined if any hop misses. */
function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * A kernel-pack rule (scopeKey "kernel") applies to every event; a tenant
 * overlay applies only to its own scope. This keeps shared content global while
 * letting a customer add or tune rules without touching the kernel pack.
 */
export function ruleAppliesToScope(
  ruleScopeKey: string,
  eventScopeKey: string,
): boolean {
  return ruleScopeKey === "kernel" || ruleScopeKey === eventScopeKey;
}

/** Evaluate one predicate node against an event. */
export function matchPredicate(
  predicate: DetectionPredicate,
  event: SecurityEventView,
  ctx: EvaluationContext,
): boolean {
  if (predicate.classUid != null && event.ocsfClassUid !== predicate.classUid) {
    return false;
  }
  if (predicate.sourceKind != null && event.sourceKind !== predicate.sourceKind) {
    return false;
  }
  if (
    predicate.minSeverityId != null &&
    (event.severityId ?? 0) < predicate.minSeverityId
  ) {
    return false;
  }
  if (predicate.matchThreatIndicator) {
    const index = ctx.indicatorIndex;
    if (!index) return false;
    const hits = matchIndicatorValues(eventObservableValues(event), index);
    if (hits.length === 0) return false;
  }
  if (predicate.equals) {
    if (getPath(event.normalized, predicate.equals.path) !== predicate.equals.value) {
      return false;
    }
  }
  if (predicate.allOf && !predicate.allOf.every((p) => matchPredicate(p, event, ctx))) {
    return false;
  }
  if (predicate.anyOf && !predicate.anyOf.some((p) => matchPredicate(p, event, ctx))) {
    return false;
  }
  return true;
}

/** Evaluate all rules against one event; emit a candidate per firing rule. */
export function evaluateRulesForEvent(
  rules: DetectionRuleView[],
  event: SecurityEventView,
  ctx: EvaluationContext = {},
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleAppliesToScope(rule.scopeKey, event.scopeKey)) continue;
    if (!matchPredicate(rule.predicate, event, ctx)) continue;

    const indicatorMatches = ctx.indicatorIndex
      ? matchIndicatorValues(eventObservableValues(event), ctx.indicatorIndex)
      : [];

    candidates.push({
      detectionKey: `${rule.ruleKey}:${event.eventKey}`,
      ruleId: rule.id,
      scopeKey: event.scopeKey,
      customerAccountId: event.customerAccountId,
      customerSiteId: event.customerSiteId,
      severity: rule.severity,
      riskScore: severityToRisk(rule.severity) + (indicatorMatches.length ? 10 : 0),
      matchedEventRefs: [event.eventKey],
      enrichment: {
        ruleKey: rule.ruleKey,
        ruleName: rule.name,
        mitreTechniques: rule.mitreTechniques ?? [],
        ...(indicatorMatches.length ? { indicatorMatches } : {}),
      },
      firstSeenAt: event.time,
      lastSeenAt: event.time,
    });
  }
  return candidates;
}
