// apps/web/lib/ea/it4it-coverage-extract.ts
//
// Pure, deterministic IT4IT coverage extractor. Joins the seeded IT4IT functional-criteria
// tree against live DPF evidence (agents, business capabilities) and derives an
// evidence-derived coverage status + transparent rollup score per functional component,
// with criteria inheriting their component status at derived confidence. No IO, no prisma.
//
// Honesty discipline (spec section 2): the automated unit is the functional COMPONENT, not
// the individual normative criterion. Derived statuses are limited to what coarse evidence
// can actually support (implemented / partial / not_started). "planned" and promotion to
// "verified" are operator/coworker judgments applied through the override path, never
// fabricated here. No-data is not_started, never a passing or failing colour.
//
// The reconcile shell (reconcile-it4it-coverage.ts) supplies facts and persists the write
// plan; this module owns all the math so it is unit-testable in isolation.
// Spec: docs/superpowers/specs/2026-06-24-it4it-conformance-coverage-heatmap-design.md (sections 2, 4).

import {
  type ReferenceCoverageStatus,
  type It4itCapabilityGroup,
  evidenceStreamToCapabilityGroup,
  normalizeIt4itEvidenceStream,
  extractSectionToken,
  sectionCovers,
  IT4IT_LEGACY_STREAM_LABELS,
} from "./it4it-crosswalk";

// Stable marker convention used in lieu of a schema provenance field (spec section 1). A
// row the projection owns carries confidence === DERIVED_CONFIDENCE and a rationale that
// begins with PROJECTION_RATIONALE_PREFIX. Operator/coworker rows use a VERIFIED_CONFIDENCE
// and are never overwritten.
export const PROJECTION_RATIONALE_PREFIX = "it4it-coverage-projection:";
export const DERIVED_CONFIDENCE = "derived";
export const VERIFIED_CONFIDENCES = ["verified", "high"] as const;

// Transparent rollup weights. Surfaced in evidenceSummary + UI so an enterprise architect
// can challenge the number (spec section 2).
export const STATUS_ROLLUP_VALUE: Record<ReferenceCoverageStatus, number | null> = {
  implemented: 1,
  partial: 0.5,
  planned: 0.25,
  not_started: 0,
  out_of_mvp: null, // excluded from the denominator
};

export function normativeWeight(normativeClass: string | null | undefined): number {
  switch ((normativeClass ?? "").toLowerCase()) {
    case "required":
      return 2;
    case "recommended":
      return 1;
    case "optional":
      return 0.5;
    default:
      return 0.5; // unset
  }
}

export const ROLLUP_METHOD =
  "score = sum(status_value * normative_weight) / sum(normative_weight); " +
  "status_value implemented=1 partial=0.5 planned=0.25 not_started=0 out_of_mvp=excluded; " +
  "normative_weight required=2 recommended=1 optional=0.5 unset=0.5";

// Per-component evidence score (0..100) -> status. Uses only signals that are actually
// populated in live data: workforce presence (agents tagged to the component's value
// stream), capability coverage, built capability trace links (future signal; currently
// sparse), and DIRECT component-level evidence (agent it4itSections that cover the
// component's criteria source references). The weights are deliberately transparent so an
// architect can challenge them, and confidence stays "derived" so even "implemented" reads
// as evidence-suggested-not-certified until an operator verifies.
export const EVIDENCE_WEIGHTS = {
  agentsPresent: 35,
  capabilitiesPresent: 30,
  builtCapabilities: 20,
  perSectionMatch: 25,
  maxSectionMatches: 2,
} as const;

export const EVIDENCE_SCORE_METHOD =
  "evidence_score = 35*(agents>0) + 30*(capabilities>0) + 20*(built_capabilities>0) + " +
  "25*min(section_matches,2), capped at 100; status: score>=70 implemented, score>0 partial, score=0 not_started";

// ── Fact inputs (all plain data; the reconcile shell maps live rows onto these) ──────────

export interface It4itElementFact {
  id: string;
  kind: string; // capability_group | function | component | criterion | value_stream | value_stream_stage
  slug: string;
  name: string;
  parentId: string | null;
  normativeClass: string | null;
  sourceReference: string | null;
}

export interface It4itAgentFact {
  valueStream: string | null;
  it4itSections: string[];
}

export interface It4itCapabilityFact {
  it4itValueStreams: string[];
  hasBuiltTraceLink: boolean; // links to a built digitalProduct / eaElement (not just a backlog item)
}

export interface It4itExistingAssessmentFact {
  modelElementId: string;
  coverageStatus: string;
  confidence: string | null;
  rationale: string | null;
}

export interface It4itCoverageFacts {
  elements: It4itElementFact[];
  agents: It4itAgentFact[];
  capabilities: It4itCapabilityFact[];
  existingAssessments: It4itExistingAssessmentFact[];
}

// ── Outputs ──────────────────────────────────────────────────────────────────────────

export interface It4itComponentCoverage {
  componentId: string;
  componentSlug: string;
  componentName: string;
  capabilityGroup: It4itCapabilityGroup | null;
  status: ReferenceCoverageStatus;
  score: number; // 0..100, rounded
  criteriaCount: number;
  requiredCriteriaCount: number;
  evidence: {
    agents: number;
    capabilities: number;
    capabilitiesWithBuilds: number;
    sectionMatches: number;
  };
}

export interface It4itGroupRollup {
  group: It4itCapabilityGroup;
  status: ReferenceCoverageStatus;
  score: number; // 0..100, rounded
  componentCount: number;
  componentsWithEvidence: number;
}

export interface It4itWritePlanRow {
  modelElementId: string;
  kind: "component" | "criterion";
  coverageStatus: ReferenceCoverageStatus;
  confidence: string;
  rationale: string;
  evidenceSummary: string;
}

export interface It4itCoverageGap {
  componentId: string;
  componentSlug: string;
  componentName: string;
  capabilityGroup: It4itCapabilityGroup | null;
  requiredCriteriaCount: number;
}

export interface It4itCoverageModel {
  components: It4itComponentCoverage[];
  groupRollups: It4itGroupRollup[];
  platformScore: number; // 0..100, rounded — weighted over functional criteria
  writePlan: It4itWritePlanRow[]; // platform-scope rows to upsert (no-clobber already applied)
  preservedVerified: number; // rows skipped because an operator/coworker verified them
  gaps: It4itCoverageGap[]; // not_started components that carry required criteria
  hygiene: {
    unknownStreamAgents: number;
    legacyStreamAgents: number;
    nullStreamAgents: number;
  };
  summary: {
    componentsTotal: number;
    componentsAssessed: number;
    componentsWithEvidence: number;
    requiredCriteriaTotal: number;
    requiredCriteriaImplemented: number;
    requiredCriteriaPartial: number;
    requiredCriteriaNotStarted: number;
  };
  method: string;
}

interface GroupEvidence {
  agents: number;
  capabilities: number;
  capabilitiesWithBuilds: number;
}

function emptyGroupEvidence(): GroupEvidence {
  return { agents: 0, capabilities: 0, capabilitiesWithBuilds: 0 };
}

function isVerified(a: It4itExistingAssessmentFact): boolean {
  const c = (a.confidence ?? "").toLowerCase();
  return (VERIFIED_CONFIDENCES as readonly string[]).includes(c);
}

// A row is owned by (writable by) the projection when it is absent, or carries derived
// confidence, or its rationale begins with the projection prefix. Otherwise it is an
// operator/coworker assessment and must be preserved.
function isProjectionWritable(a: It4itExistingAssessmentFact | undefined): boolean {
  if (!a) return true;
  if (isVerified(a)) return false;
  if ((a.confidence ?? "").toLowerCase() === DERIVED_CONFIDENCE) return true;
  if ((a.rationale ?? "").startsWith(PROJECTION_RATIONALE_PREFIX)) return true;
  // Has a non-derived confidence and is not projection-authored -> treat as human-owned.
  return false;
}

function deriveComponentEvidence(
  ev: GroupEvidence,
  sectionMatches: number,
): { status: ReferenceCoverageStatus; evidenceScore: number } {
  let score = 0;
  if (ev.agents > 0) score += EVIDENCE_WEIGHTS.agentsPresent;
  if (ev.capabilities > 0) score += EVIDENCE_WEIGHTS.capabilitiesPresent;
  if (ev.capabilitiesWithBuilds > 0) score += EVIDENCE_WEIGHTS.builtCapabilities;
  score += EVIDENCE_WEIGHTS.perSectionMatch * Math.min(sectionMatches, EVIDENCE_WEIGHTS.maxSectionMatches);
  score = Math.min(score, 100);
  const status: ReferenceCoverageStatus =
    score >= 70 ? "implemented" : score > 0 ? "partial" : "not_started";
  return { status, evidenceScore: score };
}

/**
 * Build the IT4IT coverage model from live facts. Pure and deterministic: identical facts
 * always yield an identical model (important for steward idempotency).
 *
 * @example
 * const model = buildIt4itCoverageModel({
 *   elements, agents, capabilities, existingAssessments: [],
 * });
 * // model.writePlan -> rows to upsert on the platform scope
 * // model.platformScore -> evidence-derived headline (0..100)
 */
export function buildIt4itCoverageModel(facts: It4itCoverageFacts): It4itCoverageModel {
  const byId = new Map<string, It4itElementFact>();
  for (const e of facts.elements) byId.set(e.id, e);

  // Resolve the capability group for any element by walking parents up to a capability_group.
  const groupCache = new Map<string, It4itCapabilityGroup | null>();
  function resolveGroup(elementId: string | null): It4itCapabilityGroup | null {
    if (!elementId) return null;
    if (groupCache.has(elementId)) return groupCache.get(elementId) ?? null;
    const el = byId.get(elementId);
    if (!el) {
      groupCache.set(elementId, null);
      return null;
    }
    let group: It4itCapabilityGroup | null = null;
    if (el.kind === "capability_group") {
      const name = el.name as It4itCapabilityGroup;
      group = name;
    } else {
      group = resolveGroup(el.parentId);
    }
    groupCache.set(elementId, group);
    return group;
  }

  // ── Aggregate evidence per capability group ──────────────────────────────────────────
  const groupEvidence = new Map<It4itCapabilityGroup, GroupEvidence>();
  function bumpGroup(group: It4itCapabilityGroup, key: keyof GroupEvidence, by = 1) {
    const ev = groupEvidence.get(group) ?? emptyGroupEvidence();
    ev[key] += by;
    groupEvidence.set(group, ev);
  }

  const hygiene = { unknownStreamAgents: 0, legacyStreamAgents: 0, nullStreamAgents: 0 };

  for (const agent of facts.agents) {
    const raw = agent.valueStream;
    if (!raw || !raw.trim()) {
      hygiene.nullStreamAgents += 1;
      continue;
    }
    if (IT4IT_LEGACY_STREAM_LABELS.has(raw.trim().toLowerCase())) {
      hygiene.legacyStreamAgents += 1;
    }
    const normalized = normalizeIt4itEvidenceStream(raw);
    if (!normalized) {
      hygiene.unknownStreamAgents += 1;
      continue;
    }
    const group = evidenceStreamToCapabilityGroup(raw);
    if (group) bumpGroup(group, "agents");
    // cross-cutting normalizes fine but maps to no group -> platform context only.
  }

  for (const cap of facts.capabilities) {
    // De-duplicate group hits per capability: one capability counts once per group.
    const groupsForCap = new Set<It4itCapabilityGroup>();
    for (const stream of cap.it4itValueStreams) {
      const group = evidenceStreamToCapabilityGroup(stream);
      if (group) groupsForCap.add(group);
    }
    for (const group of groupsForCap) {
      bumpGroup(group, "capabilities");
      if (cap.hasBuiltTraceLink) bumpGroup(group, "capabilitiesWithBuilds");
    }
  }

  // ── Component-level section evidence (agent it4itSections -> criteria sourceReference) ─
  // Map each component to the set of section tokens carried by its criteria, then count how
  // many agent sections cover any of them.
  const agentSectionTokens: string[] = [];
  for (const agent of facts.agents) {
    for (const s of agent.it4itSections) {
      const tok = extractSectionToken(s);
      if (tok) agentSectionTokens.push(tok);
    }
  }
  const criteriaByComponent = new Map<string, It4itElementFact[]>();
  for (const el of facts.elements) {
    if (el.kind === "criterion" && el.parentId) {
      const arr = criteriaByComponent.get(el.parentId) ?? [];
      arr.push(el);
      criteriaByComponent.set(el.parentId, arr);
    }
  }
  function sectionMatchesForComponent(componentId: string): number {
    const criteria = criteriaByComponent.get(componentId) ?? [];
    const compTokens = new Set<string>();
    for (const c of criteria) {
      const tok = extractSectionToken(c.sourceReference);
      if (tok) compTokens.add(tok);
    }
    if (compTokens.size === 0) return 0;
    let matches = 0;
    for (const at of agentSectionTokens) {
      for (const ct of compTokens) {
        if (sectionCovers(at, ct) || sectionCovers(ct, at)) {
          matches += 1;
          break;
        }
      }
    }
    return matches;
  }

  // ── Per-component coverage ───────────────────────────────────────────────────────────
  const existingByElement = new Map<string, It4itExistingAssessmentFact>();
  for (const a of facts.existingAssessments) existingByElement.set(a.modelElementId, a);

  const components: It4itComponentCoverage[] = [];
  const writePlan: It4itWritePlanRow[] = [];
  const gaps: It4itCoverageGap[] = [];
  let preservedVerified = 0;

  const componentEls = facts.elements.filter((e) => e.kind === "component");
  for (const comp of componentEls) {
    const group = resolveGroup(comp.id);
    const ev = (group && groupEvidence.get(group)) || emptyGroupEvidence();
    const sectionMatches = sectionMatchesForComponent(comp.id);
    const { status, evidenceScore } = deriveComponentEvidence(ev, sectionMatches);
    const score = evidenceScore;

    const criteria = criteriaByComponent.get(comp.id) ?? [];
    const requiredCriteriaCount = criteria.filter(
      (c) => (c.normativeClass ?? "").toLowerCase() === "required",
    ).length;

    const evidenceSummary = JSON.stringify({
      source: "it4it-coverage-projection",
      capabilityGroup: group,
      status,
      evidenceScore,
      evidence: {
        agents: ev.agents,
        capabilities: ev.capabilities,
        capabilitiesWithBuilds: ev.capabilitiesWithBuilds,
        sectionMatches,
      },
      method: EVIDENCE_SCORE_METHOD,
    });
    const rationale = `${PROJECTION_RATIONALE_PREFIX} ${status} for "${comp.name}" (group ${group ?? "n/a"}); agents=${ev.agents} capabilities=${ev.capabilities} built=${ev.capabilitiesWithBuilds} sections=${sectionMatches}`;

    // No-clobber: skip component + its criteria rows the operator owns.
    const compExisting = existingByElement.get(comp.id);
    if (isProjectionWritable(compExisting)) {
      writePlan.push({
        modelElementId: comp.id,
        kind: "component",
        coverageStatus: status,
        confidence: DERIVED_CONFIDENCE,
        rationale,
        evidenceSummary,
      });
    } else {
      preservedVerified += 1;
    }

    for (const c of criteria) {
      const cExisting = existingByElement.get(c.id);
      if (!isProjectionWritable(cExisting)) {
        preservedVerified += 1;
        continue;
      }
      writePlan.push({
        modelElementId: c.id,
        kind: "criterion",
        coverageStatus: status, // inherited
        confidence: DERIVED_CONFIDENCE,
        rationale: `${PROJECTION_RATIONALE_PREFIX} inherited ${status} from component "${comp.name}"`,
        evidenceSummary,
      });
    }

    components.push({
      componentId: comp.id,
      componentSlug: comp.slug,
      componentName: comp.name,
      capabilityGroup: group,
      status,
      score,
      criteriaCount: criteria.length,
      requiredCriteriaCount,
      evidence: {
        agents: ev.agents,
        capabilities: ev.capabilities,
        capabilitiesWithBuilds: ev.capabilitiesWithBuilds,
        sectionMatches,
      },
    });

    if (status === "not_started" && requiredCriteriaCount > 0) {
      gaps.push({
        componentId: comp.id,
        componentSlug: comp.slug,
        componentName: comp.name,
        capabilityGroup: group,
        requiredCriteriaCount,
      });
    }
  }

  // ── Rollups ──────────────────────────────────────────────────────────────────────────
  // Weighted over the functional criteria (the criteria under components).
  let platformNum = 0;
  let platformDen = 0;
  const groupAgg = new Map<It4itCapabilityGroup, { num: number; den: number; comps: number; withEv: number }>();

  for (const comp of components) {
    const statusValue = STATUS_ROLLUP_VALUE[comp.status];
    if (statusValue === null) continue; // out_of_mvp excluded (not produced by v0 derivation)
    const criteria = criteriaByComponent.get(comp.componentId) ?? [];
    let compWeight = 0;
    for (const c of criteria) compWeight += normativeWeight(c.normativeClass);
    if (compWeight === 0) compWeight = normativeWeight(null); // component with no criteria still counts minimally
    platformNum += statusValue * compWeight;
    platformDen += compWeight;

    if (comp.capabilityGroup) {
      const g = groupAgg.get(comp.capabilityGroup) ?? { num: 0, den: 0, comps: 0, withEv: 0 };
      g.num += statusValue * compWeight;
      g.den += compWeight;
      g.comps += 1;
      if (comp.status !== "not_started") g.withEv += 1;
      groupAgg.set(comp.capabilityGroup, g);
    }
  }

  const platformScore = platformDen > 0 ? Math.round((platformNum / platformDen) * 100) : 0;

  const groupRollups: It4itGroupRollup[] = [];
  for (const [group, g] of groupAgg) {
    const score = g.den > 0 ? Math.round((g.num / g.den) * 100) : 0;
    const status: ReferenceCoverageStatus =
      g.withEv === 0 ? "not_started" : g.withEv === g.comps && score >= 75 ? "implemented" : "partial";
    groupRollups.push({
      group,
      status,
      score,
      componentCount: g.comps,
      componentsWithEvidence: g.withEv,
    });
  }
  groupRollups.sort((a, b) => a.group.localeCompare(b.group));

  // ── Summary counts ───────────────────────────────────────────────────────────────────
  let requiredImplemented = 0;
  let requiredPartial = 0;
  let requiredNotStarted = 0;
  let componentsWithEvidence = 0;
  for (const comp of components) {
    if (comp.status !== "not_started") componentsWithEvidence += 1;
    if (comp.status === "implemented") requiredImplemented += comp.requiredCriteriaCount;
    else if (comp.status === "partial") requiredPartial += comp.requiredCriteriaCount;
    else requiredNotStarted += comp.requiredCriteriaCount;
  }

  return {
    components,
    groupRollups,
    platformScore,
    writePlan,
    preservedVerified,
    gaps,
    hygiene,
    summary: {
      componentsTotal: components.length,
      componentsAssessed: components.length,
      componentsWithEvidence,
      requiredCriteriaTotal: requiredImplemented + requiredPartial + requiredNotStarted,
      requiredCriteriaImplemented: requiredImplemented,
      requiredCriteriaPartial: requiredPartial,
      requiredCriteriaNotStarted: requiredNotStarted,
    },
    method: ROLLUP_METHOD,
  };
}
