// apps/web/lib/explore/it4it-coverage-view.ts
//
// Pure view-shaping for the IT4IT coverage heatmap (EP-IT4IT-CONFORMANCE). Takes the raw
// IT4IT element tree + platform-scope assessment rows and produces the grouped, rolled-up
// It4itCoverageHeatmap the UI renders. No IO — the cached query lives in ea-data.ts and
// delegates here so the grouping/rollup math is unit-testable in isolation.

import { STATUS_ROLLUP_VALUE, normativeWeight, ROLLUP_METHOD } from "@/lib/ea/it4it-coverage-extract";
import type {
  CoverageStatus,
  It4itCoverageHeatmap,
  It4itCoverageGroup,
  It4itComponentCoverage,
  It4itCriterionCoverage,
} from "./reference-model-types";

export interface It4itElementRow {
  id: string;
  parentId: string | null;
  kind: string;
  name: string;
  normativeClass: string | null;
  sourceReference: string | null;
}

export interface It4itAssessmentRow {
  modelElementId: string;
  coverageStatus: string;
  confidence: string | null;
  evidenceSummary: string | null;
  updatedAt: Date;
}

const IT4IT_GROUP_ORDER = [
  "Strategy to Portfolio",
  "Requirement to Deploy",
  "Request to Fulfill",
  "Detect to Correct",
  "Supporting Functions",
];

const IT4IT_STATUS_FALLBACK_SCORE: Record<CoverageStatus, number> = {
  implemented: 100,
  partial: 50,
  planned: 25,
  not_started: 0,
  out_of_mvp: 0,
};

const IT4IT_VERIFIED_CONFIDENCES = new Set(["verified", "high"]);

export function it4itCoverageStatus(value: string | null | undefined): CoverageStatus {
  const allowed: CoverageStatus[] = ["implemented", "partial", "planned", "not_started", "out_of_mvp"];
  return allowed.includes(value as CoverageStatus) ? (value as CoverageStatus) : "not_started";
}

export function parseEvidenceScore(evidenceSummary: string | null): number | null {
  if (!evidenceSummary) return null;
  try {
    const parsed = JSON.parse(evidenceSummary) as { evidenceScore?: unknown };
    return typeof parsed.evidenceScore === "number" ? parsed.evidenceScore : null;
  } catch {
    return null;
  }
}

export function shapeIt4itCoverageHeatmap(params: {
  slug: string;
  modelName: string;
  elements: It4itElementRow[];
  assessments: It4itAssessmentRow[];
}): It4itCoverageHeatmap {
  const { slug, modelName, elements, assessments } = params;

  const byId = new Map(elements.map((e) => [e.id, e]));
  const assessmentByElement = new Map(assessments.map((a) => [a.modelElementId, a]));

  const groupCache = new Map<string, string | null>();
  function resolveGroup(elementId: string | null): string | null {
    if (!elementId) return null;
    if (groupCache.has(elementId)) return groupCache.get(elementId) ?? null;
    const el = byId.get(elementId);
    if (!el) {
      groupCache.set(elementId, null);
      return null;
    }
    const g = el.kind === "capability_group" ? el.name : resolveGroup(el.parentId);
    groupCache.set(elementId, g);
    return g;
  }

  const criteriaByComponent = new Map<string, It4itElementRow[]>();
  for (const el of elements) {
    if (el.kind === "criterion" && el.parentId) {
      const arr = criteriaByComponent.get(el.parentId) ?? [];
      arr.push(el);
      criteriaByComponent.set(el.parentId, arr);
    }
  }

  let verifiedCount = 0;
  const components: It4itComponentCoverage[] = [];
  for (const comp of elements.filter((e) => e.kind === "component")) {
    const group = resolveGroup(comp.id) ?? "Supporting Functions";
    const a = assessmentByElement.get(comp.id);
    const status = it4itCoverageStatus(a?.coverageStatus);
    const score = parseEvidenceScore(a?.evidenceSummary ?? null) ?? IT4IT_STATUS_FALLBACK_SCORE[status];
    if (a?.confidence && IT4IT_VERIFIED_CONFIDENCES.has(a.confidence.toLowerCase())) verifiedCount += 1;

    const critEls = criteriaByComponent.get(comp.id) ?? [];
    const criteria: It4itCriterionCoverage[] = critEls
      .map((c) => {
        const ca = assessmentByElement.get(c.id);
        if (ca?.confidence && IT4IT_VERIFIED_CONFIDENCES.has(ca.confidence.toLowerCase())) verifiedCount += 1;
        return {
          id: c.id,
          name: c.name,
          normativeClass: c.normativeClass,
          sourceReference: c.sourceReference,
          status: it4itCoverageStatus(ca?.coverageStatus),
          confidence: ca?.confidence ?? null,
        };
      })
      .sort((x, y) => (x.sourceReference ?? "").localeCompare(y.sourceReference ?? ""));

    components.push({
      id: comp.id,
      name: comp.name,
      capabilityGroup: group,
      status,
      score,
      confidence: a?.confidence ?? null,
      criteriaCount: critEls.length,
      requiredCriteriaCount: critEls.filter((c) => (c.normativeClass ?? "").toLowerCase() === "required").length,
      criteria,
    });
  }

  function weightedScore(comps: It4itComponentCoverage[]): number {
    let num = 0;
    let den = 0;
    for (const c of comps) {
      const sv = STATUS_ROLLUP_VALUE[c.status];
      if (sv === null) continue; // out_of_mvp excluded
      const critEls = criteriaByComponent.get(c.id) ?? [];
      let weight = 0;
      for (const ce of critEls) weight += normativeWeight(ce.normativeClass);
      if (weight === 0) weight = normativeWeight(null);
      num += sv * weight;
      den += weight;
    }
    return den > 0 ? Math.round((num / den) * 100) : 0;
  }

  const groupsMap = new Map<string, It4itComponentCoverage[]>();
  for (const c of components) {
    const arr = groupsMap.get(c.capabilityGroup) ?? [];
    arr.push(c);
    groupsMap.set(c.capabilityGroup, arr);
  }

  const groups: It4itCoverageGroup[] = [];
  for (const [group, comps] of groupsMap) {
    comps.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    groups.push({
      group,
      score: weightedScore(comps),
      componentCount: comps.length,
      componentsWithEvidence: comps.filter((c) => c.status !== "not_started").length,
      components: comps,
    });
  }
  groups.sort((a, b) => {
    const ia = IT4IT_GROUP_ORDER.indexOf(a.group);
    const ib = IT4IT_GROUP_ORDER.indexOf(b.group);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.group.localeCompare(b.group);
  });

  const latest = assessments.reduce<Date | null>((m, a) => (!m || a.updatedAt > m ? a.updatedAt : m), null);

  return {
    modelSlug: slug,
    modelName,
    hasData: assessments.length > 0,
    assessmentCount: assessments.length,
    generatedAt: latest ? latest.toISOString() : null,
    platformScore: weightedScore(components),
    groups,
    summary: {
      componentsTotal: components.length,
      componentsWithEvidence: components.filter((c) => c.status !== "not_started").length,
      implemented: components.filter((c) => c.status === "implemented").length,
      partial: components.filter((c) => c.status === "partial").length,
      requiredCriteriaTotal: components.reduce((s, c) => s + c.requiredCriteriaCount, 0),
      requiredCriteriaImplemented: components
        .filter((c) => c.status === "implemented")
        .reduce((s, c) => s + c.requiredCriteriaCount, 0),
      requiredCriteriaPartial: components
        .filter((c) => c.status === "partial")
        .reduce((s, c) => s + c.requiredCriteriaCount, 0),
      verifiedCount,
    },
    method: ROLLUP_METHOD,
  };
}
