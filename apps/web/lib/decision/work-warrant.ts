// Work Warrant — the control object of the decision-altitude control plane
// (EP-7B169558 / BI-8AB0E66D). `deriveWarrant` is where the two rigor-ends meet:
// the DECISION end (altitude, from classifyAltitude at promote-time) and the
// DIFF end (blast radius, from change-impact.ts / EP-QUALITY-RIGHTSIZING). It
// maps altitude + blast-radius + org context into the five knobs every
// downstream consumer reads — lane, budget, evidence depth, reporting format,
// context scope — so execution stops applying uniform maximal rigor to every job.
//
// Pure and dependency-free (over its own types + the AltitudeVerdict) → fully
// unit-testable with no DB/model/corpus, same as the classifier it consumes.

import type { Altitude, AltitudeBasis, AltitudeConfidence, AltitudeVerdict } from "./work-warrant-altitude";

export type Lane = "autonomous-bs" | "governed-interactive" | "direct-expert";
export type ModelTier = "economical" | "standard" | "strong";
export type EffortLevel = "low" | "medium" | "high";
export type GateProfile = "collapsed" | "standard" | "full";
export type EvidenceProfile = "minimal" | "standard" | "compliance" | "architectural";
export type ReportingProfile = "one-line" | "business" | "ledger";
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Graded blast-radius signal — derived from the code graph + EA diagrams a-priori
 *  (promote) and confirmed from the diff a-posteriori (verify). See BI-22250BA2.
 *  Optional: the warrant is derivable from altitude alone before blast radius is
 *  known; blast radius, when present, can only ESCALATE rigor, never relax it. */
export interface BlastRadius {
  downstreamCount: number;
  touchesCoreContract: boolean;
  riskLevel: RiskLevel;
}

/** Company/industry/location context from the WWWD org stance (BI-EE211BFA). */
export interface WarrantContext {
  industry?: string | null;
  jurisdiction?: string | null;
  archetype?: string | null;
}

export interface WorkWarrant {
  altitude: Altitude;
  altitudeBasis: AltitudeBasis;
  confidence: AltitudeConfidence;
  needsOperatorConfirm: boolean;
  lane: Lane;
  budget: {
    modelTier: ModelTier;
    effortLevel: EffortLevel;
    gateProfile: GateProfile;
    /** Advisory until per-phase metering lands (BI-0A6B8B38); null = unmetered. */
    tokenCeiling: number | null;
  };
  evidenceProfile: EvidenceProfile;
  reportingProfile: ReportingProfile;
  contextScope: WarrantContext;
  /** Human-readable derivation trail for the ledger + reporting. */
  reasons: string[];
}

interface AltitudeDefaults {
  lane: Lane;
  modelTier: ModelTier;
  effortLevel: EffortLevel;
  gateProfile: GateProfile;
  evidenceProfile: EvidenceProfile;
  reportingProfile: ReportingProfile;
}

// Base mapping by altitude. Low altitude = cheap + hands-off; high = strong +
// governed. The whole point of the plane: a WSID task must NOT pay WWMD rigor.
const ALTITUDE_DEFAULTS: Record<Altitude, AltitudeDefaults> = {
  WSID: {
    lane: "autonomous-bs",
    modelTier: "economical",
    effortLevel: "low",
    gateProfile: "collapsed",
    evidenceProfile: "minimal",
    reportingProfile: "one-line",
  },
  WWWD: {
    lane: "governed-interactive",
    modelTier: "standard",
    effortLevel: "medium",
    gateProfile: "standard",
    evidenceProfile: "standard",
    reportingProfile: "business",
  },
  WWMD: {
    lane: "governed-interactive",
    modelTier: "strong",
    effortLevel: "high",
    gateProfile: "full",
    evidenceProfile: "architectural",
    reportingProfile: "ledger",
  },
};

const EVIDENCE_RANK: EvidenceProfile[] = ["minimal", "standard", "compliance", "architectural"];
const LANE_RANK: Lane[] = ["autonomous-bs", "governed-interactive", "direct-expert"];

function maxEvidence(a: EvidenceProfile, b: EvidenceProfile): EvidenceProfile {
  return EVIDENCE_RANK.indexOf(a) >= EVIDENCE_RANK.indexOf(b) ? a : b;
}
function maxLane(a: Lane, b: Lane): Lane {
  return LANE_RANK.indexOf(a) >= LANE_RANK.indexOf(b) ? a : b;
}

/**
 * Derive a WorkWarrant from the altitude verdict, optional blast radius, and
 * optional org context. Blast radius and context can only ESCALATE rigor
 * (monotonic) — a warrant is safe to compute from altitude alone and only
 * hardens as more signal arrives.
 */
export function deriveWarrant(input: {
  verdict: AltitudeVerdict;
  blastRadius?: BlastRadius;
  context?: WarrantContext;
}): WorkWarrant {
  const { verdict, blastRadius, context } = input;
  const base = ALTITUDE_DEFAULTS[verdict.altitude];
  const reasons: string[] = [`altitude ${verdict.altitude} (${verdict.basis}, ${verdict.confidence})`];

  let lane = base.lane;
  let evidenceProfile = base.evidenceProfile;
  let needsOperatorConfirm = verdict.needsOperatorConfirm;

  // ── Blast-radius overlay (risk = what could break). A nominally-small change
  //    with a large blast radius must NOT run autonomously with minimal evidence. ──
  if (blastRadius) {
    const highRisk =
      blastRadius.touchesCoreContract ||
      blastRadius.riskLevel === "high" ||
      blastRadius.riskLevel === "critical" ||
      blastRadius.downstreamCount >= 25;
    const moderate = blastRadius.riskLevel === "medium" || blastRadius.downstreamCount >= 8;

    if (highRisk) {
      lane = maxLane(lane, "governed-interactive");
      evidenceProfile = maxEvidence(evidenceProfile, "architectural");
      reasons.push(
        `blast-radius escalation: ${blastRadius.touchesCoreContract ? "touches a core contract; " : ""}risk ${blastRadius.riskLevel}, ${blastRadius.downstreamCount} downstream`,
      );
      // If the altitude was low but blast radius says otherwise, confirm the escalation.
      if (verdict.altitude === "WSID") needsOperatorConfirm = true;
    } else if (moderate) {
      evidenceProfile = maxEvidence(evidenceProfile, "standard");
      reasons.push(`moderate blast radius (risk ${blastRadius.riskLevel}, ${blastRadius.downstreamCount} downstream)`);
    }
  }

  // ── Context overlay: a vertical/jurisdiction obligation raises evidence to
  //    compliance (unless already architectural). Company/industry/location
  //    scope rides along for the evidence collector + reporter (BI-EE211BFA). ──
  if (context && (context.jurisdiction || context.archetype)) {
    evidenceProfile = maxEvidence(evidenceProfile, "compliance");
    reasons.push(
      `context: ${[context.industry, context.jurisdiction, context.archetype].filter(Boolean).join(" / ")} → compliance evidence`,
    );
  }

  return {
    altitude: verdict.altitude,
    altitudeBasis: verdict.basis,
    confidence: verdict.confidence,
    needsOperatorConfirm,
    lane,
    budget: {
      modelTier: base.modelTier,
      effortLevel: base.effortLevel,
      gateProfile: base.gateProfile,
      tokenCeiling: null, // advisory until metering lands (BI-0A6B8B38)
    },
    evidenceProfile,
    reportingProfile: base.reportingProfile,
    contextScope: {
      industry: context?.industry ?? null,
      jurisdiction: context?.jurisdiction ?? null,
      archetype: context?.archetype ?? null,
    },
    reasons,
  };
}
