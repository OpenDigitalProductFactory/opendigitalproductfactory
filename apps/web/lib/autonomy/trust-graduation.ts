// Trust-graduation core for progressive autonomy (EP-8AF1C996, BI-DE4BF92F).
//
// The rules by which an AI activity's autonomy level rises or falls based on
// MEASURED agreement -- "earn autonomy by proving you make the right call."
// Pure + deterministic; it returns a RECOMMENDATION and never acts or mutates
// anything (the operator confirms a promotion). The DB substrate
// (DecisionShadowLedger, TrustState) + recording hooks are a separate BI.
//
// Founder directive 2026-06-26: ease in incrementally, validate over time, no
// YOLO. Everything starts at L0 (shadow). Thresholds + risk ceilings are explicit
// named config = the tunable dial; defaults come from the design pass:
// docs/superpowers/plans/2026-06-26-progressive-autonomy-trust-graduation-design.md

/** L0 -> L3, least to most autonomous. */
export const AUTONOMY_LEVELS = ["shadow", "propose", "supervised", "autopilot"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** Buckets actions by reversibility / blast radius. */
export type RiskClass =
  | "read-only"
  | "internal-reversible"
  | "internal-irreversible"
  | "outbound-or-floor"; // the kernel floor: irreversible/outbound/financial/access-control

/**
 * Highest autonomy a risk-class may ever reach. The kernel floor is capped at
 * "propose" forever (a human always makes that call). The internal-irreversible
 * cap is an OPEN founder question (autopilot vs supervised) -- defaulted here and
 * overridable so answering it is a one-line config change, not a rebuild.
 */
export const DEFAULT_RISK_CEILINGS: Record<RiskClass, AutonomyLevel> = {
  "read-only": "autopilot",
  "internal-reversible": "autopilot",
  "internal-irreversible": "autopilot",
  "outbound-or-floor": "propose",
};

/** Agreement evidence over a rolling window. */
export interface AgreementWindow {
  /** Decisions observed in the window. */
  samples: number;
  /** How many matched the human's actual choice / the confirmed outcome. */
  agreements: number;
}

/** agreements / samples in [0,1]; null when there is nothing to judge. */
export function agreementRate(w: AgreementWindow): number | null {
  if (w.samples <= 0) return null;
  return Math.min(1, Math.max(0, w.agreements / w.samples));
}

/** The more-restrictive (lower) of two autonomy levels. */
export function minLevel(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return levelIndex(a) <= levelIndex(b) ? a : b;
}

/** Per-level gate to climb to the NEXT level. The tunable dial. */
export interface GraduationThreshold {
  minSamples: number;
  minRate: number;
}

/** Defaults from the design pass; the founder tunes these per risk appetite. Keyed
 * by the FROM level (autopilot has no next level, so it is intentionally absent). */
export const DEFAULT_THRESHOLDS: Partial<Record<AutonomyLevel, GraduationThreshold>> = {
  shadow: { minSamples: 20, minRate: 0.9 }, // L0 -> L1
  propose: { minSamples: 20, minRate: 0.9 }, // L1 -> L2
  supervised: { minSamples: 30, minRate: 0.95 }, // L2 -> L3
};

/** Below this rate (with enough samples) trust drops a level (symmetric demotion). */
export const DEMOTION_RATE = 0.7;
export const DEMOTION_MIN_SAMPLES = 10;

export type TrustRecommendation =
  | { action: "hold"; level: AutonomyLevel; reason: string }
  | { action: "promote"; from: AutonomyLevel; to: AutonomyLevel; reason: string }
  | { action: "demote"; from: AutonomyLevel; to: AutonomyLevel; reason: string };

const NEXT_LEVEL: Record<AutonomyLevel, AutonomyLevel | null> = {
  shadow: "propose",
  propose: "supervised",
  supervised: "autopilot",
  autopilot: null,
};
const PREV_LEVEL: Record<AutonomyLevel, AutonomyLevel | null> = {
  shadow: null,
  propose: "shadow",
  supervised: "propose",
  autopilot: "supervised",
};

function levelIndex(l: AutonomyLevel): number {
  return AUTONOMY_LEVELS.indexOf(l);
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

/**
 * Recommend a trust change for one (coworker x activity x risk) given its
 * current level and agreement window. Pure -- NEVER auto-applies; a promotion is
 * a recommendation the operator confirms. Precedence:
 *   1. Demotion first (safety): a bad track record drops a level.
 *   2. Risk ceiling: cannot promote past the class's cap (floor caps at propose).
 *   3. Promotion: only when the per-level gate (samples + rate) is met.
 *   4. Otherwise hold, with the reason it is not yet eligible.
 */
export function recommendTrustChange(args: {
  level: AutonomyLevel;
  risk: RiskClass;
  window: AgreementWindow;
  thresholds?: Partial<Record<AutonomyLevel, GraduationThreshold>>;
  ceilings?: Record<RiskClass, AutonomyLevel>;
  /**
   * Regulatory/compliance cap for this (industry x jurisdiction x activity),
   * independent of earned trust (BI-40CD8ACD). The EFFECTIVE ceiling is the more
   * restrictive of the risk ceiling and this. Omit when the activity is not
   * regulated (trust + risk govern alone). A regulated activity stays capped no
   * matter how high the agreement -- only a compliance change lifts it.
   */
  regulatoryCeiling?: AutonomyLevel;
}): TrustRecommendation {
  const { level, risk, window } = args;
  const rate = agreementRate(window);
  const riskCeiling = (args.ceilings ?? DEFAULT_RISK_CEILINGS)[risk];
  const ceiling = args.regulatoryCeiling ? minLevel(riskCeiling, args.regulatoryCeiling) : riskCeiling;
  const regulatoryBinds =
    args.regulatoryCeiling != null && levelIndex(args.regulatoryCeiling) < levelIndex(riskCeiling);

  // 1. Demotion first.
  if (rate !== null && window.samples >= DEMOTION_MIN_SAMPLES && rate < DEMOTION_RATE) {
    const prev = PREV_LEVEL[level];
    if (prev) {
      return { action: "demote", from: level, to: prev, reason: `agreement ${pct(rate)} below the ${pct(DEMOTION_RATE)} floor` };
    }
    return { action: "hold", level, reason: `agreement ${pct(rate)} is low but already at shadow` };
  }

  // 2. Ceiling reached (risk and/or regulatory -- the more restrictive binds).
  if (levelIndex(level) >= levelIndex(ceiling)) {
    return {
      action: "hold",
      level,
      reason: regulatoryBinds
        ? `regulatory ceiling (${ceiling}) caps this activity regardless of agreement -- only a compliance change lifts it`
        : ceiling === "propose"
          ? `kernel-floor risk (${risk}) is capped at propose -- an owner always confirms`
          : `at the ${risk} ceiling (${ceiling})`,
    };
  }

  // 3. Promotion gate.
  const next = NEXT_LEVEL[level];
  if (!next) return { action: "hold", level, reason: "already at the most autonomous level" };
  const gate = (args.thresholds ?? DEFAULT_THRESHOLDS)[level];
  if (!gate) return { action: "hold", level, reason: `no graduation gate defined for ${level}` };
  if (rate === null || window.samples < gate.minSamples) {
    return { action: "hold", level, reason: `need >= ${gate.minSamples} samples to judge (have ${window.samples})` };
  }
  if (rate >= gate.minRate) {
    return { action: "promote", from: level, to: next, reason: `agreement ${pct(rate)} >= ${pct(gate.minRate)} over ${window.samples} samples` };
  }
  return { action: "hold", level, reason: `agreement ${pct(rate)} below the ${pct(gate.minRate)} bar to reach ${next}` };
}
