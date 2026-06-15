// Field Dispatch — value-aware assignment scoring (F4).
//
// Which resource should take a job. Skill is a HARD gate (you cannot send an
// unqualified technician); among the qualified-and-available, candidates are
// ranked by proximity, current load, and — the competitive catch-up — the job's
// value matched to the resource's value-fit (ServiceTitan/Housecall already
// weight ticket size, not just geography). Urgency reshapes the weights:
// emergencies pull toward "whoever is closest now."
//
// Pure: the runtime resolves proximity (from geo/ETA), availability, load, and
// value-fit, then calls this. The result is a ranked recommendation with a
// rationale and a confidence — it does NOT mutate assignment (the dispatcher
// proposes; a human or a governed auto-assign policy commits). See
// docs/superpowers/specs/2026-06-13-field-dispatch-capability-design.md (F4, §5).

export type AssignmentUrgency = "routine" | "priority" | "urgent" | "emergency";

export interface AssignmentJob {
  /** Skills the job requires; a candidate missing any is ineligible. */
  requiredSkills?: string[];
  urgency?: AssignmentUrgency;
  /** 0–1: how much the job's value should weigh (a high-ticket install → near 1). */
  valueWeight?: number;
}

export interface AssignmentCandidate {
  resourceId: string;
  skills: string[];
  available: boolean;
  /** 0–1, 1 = closest/shortest ETA. Resolved by the runtime from geo/ETA. */
  proximityScore?: number;
  /** 0–1, 1 = fully loaded today. Prefer less-loaded resources. */
  loadFactor?: number;
  /** 0–1, suitability for high-value work (close rate, seniority). */
  valueFit?: number;
}

export interface AssignmentWeights {
  proximity: number;
  load: number;
  value: number;
}

export interface AssignmentScore {
  resourceId: string;
  eligible: boolean;
  score: number;
  breakdown: { proximity: number; load: number; value: number };
  reasons: string[];
}

/** Weight profile by urgency: emergencies prioritize getting someone there fast. */
export function weightsForUrgency(urgency: AssignmentUrgency = "routine"): AssignmentWeights {
  switch (urgency) {
    case "emergency":
      return { proximity: 0.7, load: 0.2, value: 0.1 };
    case "urgent":
      return { proximity: 0.5, load: 0.3, value: 0.2 };
    case "priority":
      return { proximity: 0.4, load: 0.3, value: 0.3 };
    case "routine":
      return { proximity: 0.35, load: 0.3, value: 0.35 };
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hasAllRequiredSkills(job: AssignmentJob, candidate: AssignmentCandidate): boolean {
  const required = job.requiredSkills ?? [];
  if (required.length === 0) return true;
  const have = new Set(candidate.skills);
  return required.every((skill) => have.has(skill));
}

/**
 * Score one candidate for a job. Ineligible (unavailable or missing a required
 * skill) → score 0 with the reason. Eligible → a weighted blend of proximity,
 * spare capacity, and value-fit, with weights chosen by urgency.
 */
export function scoreAssignment(
  job: AssignmentJob,
  candidate: AssignmentCandidate,
  weights: AssignmentWeights = weightsForUrgency(job.urgency),
): AssignmentScore {
  const reasons: string[] = [];

  if (!candidate.available) {
    return { resourceId: candidate.resourceId, eligible: false, score: 0, breakdown: { proximity: 0, load: 0, value: 0 }, reasons: ["unavailable"] };
  }
  if (!hasAllRequiredSkills(job, candidate)) {
    const missing = (job.requiredSkills ?? []).filter((s) => !candidate.skills.includes(s));
    return { resourceId: candidate.resourceId, eligible: false, score: 0, breakdown: { proximity: 0, load: 0, value: 0 }, reasons: [`missing required skill(s): ${missing.join(", ")}`] };
  }

  const proximity = clamp01(candidate.proximityScore ?? 0.5);
  const spareCapacity = clamp01(1 - (candidate.loadFactor ?? 0));
  const valueFit = clamp01((job.valueWeight ?? 0.5) * (candidate.valueFit ?? 0.5));

  const breakdown = {
    proximity: weights.proximity * proximity,
    load: weights.load * spareCapacity,
    value: weights.value * valueFit,
  };
  const score = breakdown.proximity + breakdown.load + breakdown.value;

  reasons.push(`proximity ${proximity.toFixed(2)}`, `spare capacity ${spareCapacity.toFixed(2)}`, `value-fit ${valueFit.toFixed(2)}`);
  return { resourceId: candidate.resourceId, eligible: true, score, breakdown, reasons };
}

/**
 * Rank candidates for a job: eligible first (highest score → lowest), then
 * ineligible. Stable on ties by input order. The top eligible entry is the
 * dispatcher's recommended assignment; `confidence` (the gap to the runner-up)
 * tells the runtime how clear-cut it is.
 */
export function rankAssignments(
  job: AssignmentJob,
  candidates: AssignmentCandidate[],
  weights: AssignmentWeights = weightsForUrgency(job.urgency),
): AssignmentScore[] {
  return candidates
    .map((candidate, index) => ({ score: scoreAssignment(job, candidate, weights), index }))
    .sort((a, b) => {
      if (a.score.eligible !== b.score.eligible) return a.score.eligible ? -1 : 1;
      if (b.score.score !== a.score.score) return b.score.score - a.score.score;
      return a.index - b.index; // stable tie-break
    })
    .map((entry) => entry.score);
}

export interface AssignmentRecommendation {
  recommended: AssignmentScore | null;
  /** 0–1 margin between the top two eligible candidates; 1 when only one is eligible. */
  confidence: number;
  ranked: AssignmentScore[];
}

/** The dispatcher-facing recommendation: top eligible candidate + a confidence margin. */
export function recommendAssignment(
  job: AssignmentJob,
  candidates: AssignmentCandidate[],
  weights: AssignmentWeights = weightsForUrgency(job.urgency),
): AssignmentRecommendation {
  const ranked = rankAssignments(job, candidates, weights);
  const eligible = ranked.filter((r) => r.eligible);
  if (eligible.length === 0) return { recommended: null, confidence: 0, ranked };
  const confidence = eligible.length === 1 ? 1 : clamp01(eligible[0].score - eligible[1].score);
  return { recommended: eligible[0], confidence, ranked };
}
