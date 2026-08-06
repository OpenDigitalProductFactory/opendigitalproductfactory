// Trust-envelope instance one — fair candidate evaluation (BI-A59CB2EA,
// EP-VERIFICATION-INTEGRITY; spec §6). The trust LAYER a candidate-evaluation
// coworker wraps around evaluate_profession_decision (WSID). It does NOT build an
// ATS — no applicant/requisition substrate exists yet (spec §10 Q4); this is the
// decision-trust surface a future ATS plugs into.
//
// Guardrails (spec §6.3), all enforced here:
//  1. Protected characteristics are excluded from the scoring vector, and a proxy
//     detector blocks indirect encodings.
//  2. Demographics live ONLY on a monitoring-only rail (ProtectedMonitoringObservation),
//     structurally separate from scoring — see the schema comment. This module
//     builds those observations but never returns them from a scoring function.
//  3. Human-in-the-loop: hiring autonomy is capped at "propose" with
//     humanControlRequired = true (a recommendation, never an autonomous verdict).
//
// Axes come from a formal job analysis (Fork A / A3 baseline), so job-relatedness
// is defensible under EEOC/Uniform-Guidelines §14, NYC LL144, and the four-fifths
// rule; learned weights may only ever arrive as advisory, adverse-impact-checked
// proposals and never touch a protected-proxy axis.

/** Base protected classes (Title VII + ADEA + ADA + common state additions). */
export const PROTECTED_CHARACTERISTICS = [
  "race",
  "color",
  "religion",
  "sex",
  "gender",
  "gender_identity",
  "sexual_orientation",
  "national_origin",
  "age",
  "disability",
  "pregnancy",
  "marital_status",
  "genetic_information",
  "veteran_status",
  "citizenship",
] as const;
export type ProtectedCharacteristic = (typeof PROTECTED_CHARACTERISTICS)[number];

/** Known proxy signals: a substring in an axis key/description → the class it can encode. */
const PROXY_PATTERNS: Array<{ pattern: RegExp; encodes: ProtectedCharacteristic; note: string }> = [
  { pattern: /\bgraduat\w*[\s_-]*(year|date)\b|\bclass of\b|\byears? since\b/i, encodes: "age", note: "graduation timing encodes age" },
  { pattern: /\bage\b|\bdate of birth\b|\bdob\b/i, encodes: "age", note: "direct age reference" },
  { pattern: /\bzip\b|\bpostal\b|\bneighborhood\b|\bdistance\b|\bcommute\b|\bproximity\b/i, encodes: "race", note: "location can proxy race/income" },
  { pattern: /\bname\b|\bnative speaker\b|\baccent\b|\bmother tongue\b/i, encodes: "national_origin", note: "name/language can proxy national origin" },
  { pattern: /\bphoto\b|\bheadshot\b|\bappearance\b/i, encodes: "race", note: "appearance encodes multiple protected classes" },
  { pattern: /\bsalary history\b|\bprior (pay|compensation)\b/i, encodes: "sex", note: "salary history perpetuates sex-based pay gaps" },
  { pattern: /\bemployment gap\b|\bcareer break\b|\bcontinuous employment\b/i, encodes: "pregnancy", note: "employment gaps proxy pregnancy/caregiving/disability" },
  { pattern: /\bfraternity\b|\bsorority\b|\bcountry club\b|\balma mater\b/i, encodes: "race", note: "affinity/club signals can proxy race/class" },
  { pattern: /\bpregnan/i, encodes: "pregnancy", note: "direct pregnancy reference" },
  { pattern: /\bdisab|\bmedical condition\b|\bhealth\b/i, encodes: "disability", note: "health/disability reference" },
];

export type EvalAxis = { key: string; description: string; jobAnalysisRef?: string | null };

export type ProxyFlag = {
  axisKey: string;
  encodes: ProtectedCharacteristic;
  note: string;
};

export type CandidateAxisScreen = {
  admissible: boolean;
  /** Axes that ARE a protected characteristic (hard block). */
  protectedAxes: string[];
  /** Axes flagged as indirect proxies (hard block until justified/removed). */
  proxyFlags: ProxyFlag[];
  /** Job-analysis-derived axes missing their justification (A3 defensibility gap). */
  axesMissingJobAnalysis: string[];
  errors: string[];
};

function isProtectedKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[\s-]+/g, "_");
  return (PROTECTED_CHARACTERISTICS as readonly string[]).includes(norm);
}

/**
 * Screen a candidate-evaluation axis set before it is admissible as a scoring
 * vector. Blocks if any axis is a protected characteristic or a detected proxy,
 * and (when `requireJobAnalysis`) flags axes lacking a job-analysis reference.
 */
export function screenCandidateAxes(input: {
  axes: EvalAxis[];
  /** Extra jurisdiction-resolved protected classes beyond the base set. */
  additionalProtected?: string[];
  requireJobAnalysis?: boolean;
}): CandidateAxisScreen {
  const extra = new Set((input.additionalProtected ?? []).map((s) => s.toLowerCase().replace(/[\s-]+/g, "_")));
  const protectedAxes: string[] = [];
  const proxyFlags: ProxyFlag[] = [];
  const axesMissingJobAnalysis: string[] = [];

  for (const axis of input.axes) {
    const normKey = axis.key.toLowerCase().replace(/[\s-]+/g, "_");
    if (isProtectedKey(axis.key) || extra.has(normKey)) {
      protectedAxes.push(axis.key);
    }
    const haystack = `${axis.key} ${axis.description}`;
    for (const p of PROXY_PATTERNS) {
      if (p.pattern.test(haystack)) {
        proxyFlags.push({ axisKey: axis.key, encodes: p.encodes, note: p.note });
      }
    }
    if (input.requireJobAnalysis && !axis.jobAnalysisRef) {
      axesMissingJobAnalysis.push(axis.key);
    }
  }

  const errors: string[] = [];
  if (protectedAxes.length > 0) {
    errors.push(`protected characteristics cannot be scoring axes: ${protectedAxes.join(", ")}`);
  }
  if (proxyFlags.length > 0) {
    errors.push(
      `axes flagged as protected-class proxies: ${proxyFlags.map((f) => `${f.axisKey}→${f.encodes}`).join(", ")}`,
    );
  }
  if (axesMissingJobAnalysis.length > 0) {
    errors.push(`axes lack a job-analysis reference (A3 defensibility): ${axesMissingJobAnalysis.join(", ")}`);
  }

  return {
    admissible: protectedAxes.length === 0 && proxyFlags.length === 0 && axesMissingJobAnalysis.length === 0,
    protectedAxes,
    proxyFlags,
    axesMissingJobAnalysis,
    errors,
  };
}

/** Hiring autonomy: recommendation, never verdict (spec §6.3.3/§6.3.4). */
export type HiringAutonomyPolicy = {
  activityClass: "hiring";
  jurisdiction: string;
  maxAutonomyLevel: "propose";
  humanControlRequired: true;
  outputKind: "recommendation";
};

export function hiringAutonomyPolicy(jurisdiction: string): HiringAutonomyPolicy {
  return {
    activityClass: "hiring",
    jurisdiction,
    maxAutonomyLevel: "propose",
    humanControlRequired: true,
    outputKind: "recommendation",
  };
}

// ————————————————————————————————————————————————————————————————
// Monitoring-only demographic rail — structurally separate from scoring.
// These functions produce/aggregate ProtectedMonitoringObservation-shaped data.
// NOTHING here is consumed by any scoring function in this module: the rail is
// referenced only by an opaque `evaluationRef`, never a scoring foreign key.
// ————————————————————————————————————————————————————————————————

export type MonitoringObservationInput = {
  evaluationRef: string;
  jurisdiction: string;
  protectedClass: ProtectedCharacteristic;
  classValue: string;
  selectionOutcome?: "advanced" | "rejected" | "hired" | null;
  consentBasis?: string;
};

export type MonitoringObservation = MonitoringObservationInput & {
  activityClass: "hiring";
  consentBasis: string;
};

export function buildMonitoringObservation(input: MonitoringObservationInput): MonitoringObservation {
  return {
    ...input,
    activityClass: "hiring",
    selectionOutcome: input.selectionOutcome ?? null,
    consentBasis: input.consentBasis ?? "none",
  };
}

export type ImpactRatio = {
  protectedClass: string;
  classValue: string;
  selectionRate: number;
  ratioToTop: number;
  /** True when the four-fifths rule is violated (ratio < 0.8) — presumptive adverse impact. */
  adverseImpact: boolean;
};

/**
 * Four-fifths / adverse-impact computation over the monitoring rail. For each
 * protected class, compute each group's selection rate (advanced-or-hired /
 * total), then the ratio of each to the highest-selected group. A ratio below
 * 0.8 flags presumptive adverse impact (EEOC Uniform Guidelines / NYC LL144).
 */
export function computeAdverseImpact(observations: MonitoringObservation[]): ImpactRatio[] {
  const byClass = new Map<string, Map<string, { selected: number; total: number }>>();
  for (const o of observations) {
    const groups = byClass.get(o.protectedClass) ?? new Map();
    const cell = groups.get(o.classValue) ?? { selected: 0, total: 0 };
    cell.total += 1;
    if (o.selectionOutcome === "advanced" || o.selectionOutcome === "hired") cell.selected += 1;
    groups.set(o.classValue, cell);
    byClass.set(o.protectedClass, groups);
  }

  const out: ImpactRatio[] = [];
  for (const [protectedClass, groups] of byClass) {
    const rates = [...groups.entries()].map(([classValue, c]) => ({
      classValue,
      selectionRate: c.total > 0 ? c.selected / c.total : 0,
    }));
    const topRate = rates.reduce((m, r) => Math.max(m, r.selectionRate), 0);
    for (const r of rates) {
      const ratio = topRate > 0 ? r.selectionRate / topRate : 1;
      out.push({
        protectedClass,
        classValue: r.classValue,
        selectionRate: r.selectionRate,
        ratioToTop: ratio,
        adverseImpact: topRate > 0 && ratio < 0.8,
      });
    }
  }
  return out;
}
