// EP-ONBOARDING-INTAKE P0 — org-wide risk posture home + industry-derived default.
//
// Spec: docs/superpowers/specs/2026-06-20-onboarding-intake-derivation-design.md §5
//
// Risk posture is the org-wide autonomy/risk appetite — the structured companion
// to the prose `howWeDecide` WWWD stance. One knob (BusinessContext.riskPosture)
// for which an industry sets a conservative DEFAULT, mirroring the retention
// floors: the same regulated industries that carry a retention floor
// (INDUSTRY_RETENTION_FLOORS) start at a conservative risk posture. An industry
// can only ever make the default MORE cautious, never less — "progressive" is
// reachable only by an explicit operator choice; we never assume an industry
// wants more autonomy.
//
// Crucially this sets the autonomy ENVELOPE (the ceiling + maturation rate), NOT
// the live autonomy level: the autopilot trust dial still starts HITL-first and
// earns autonomy on evidence. resolveRiskEnvelope() maps the posture to that
// envelope at read time (no stored derivation — single source of truth is the
// one `riskPosture` knob). Consumers (trust dial, agent governance seed,
// self-upgrade window, capability activation, outbound strictness, edge deploy)
// are wired in P1; this module is the inert home + derivation only.

import { toFloorKey } from "@/lib/operate/retention/industry-floors";
import type { DecisionAutonomyPolicy } from "@/lib/decision-perspective/types";

/** The org-wide risk posture knob. Closed enum (AGENTS.md §3). */
export const RISK_POSTURES = ["conservative", "balanced", "progressive"] as const;
export type RiskPosture = (typeof RISK_POSTURES)[number];

/** Default when no industry signal raises caution. */
export const DEFAULT_RISK_POSTURE: RiskPosture = "balanced";

/** Provenance of the stored posture. */
export const RISK_POSTURE_SOURCES = ["industry-default", "operator"] as const;
export type RiskPostureSource = (typeof RISK_POSTURE_SOURCES)[number];

export function isRiskPosture(v: unknown): v is RiskPosture {
  return typeof v === "string" && (RISK_POSTURES as readonly string[]).includes(v);
}

export function isRiskPostureSource(v: unknown): v is RiskPostureSource {
  return typeof v === "string" && (RISK_POSTURE_SOURCES as readonly string[]).includes(v);
}

/**
 * Industry categories whose DEFAULT posture is conservative. Keyed by the same
 * canonical floor keys as INDUSTRY_RETENTION_FLOORS (and resolved through the
 * shared `toFloorKey` alias map, so freeform "legal"/"financial"/"medical" land
 * here too). Anything not listed defaults to "balanced". This is deliberately a
 * floor, not a full mapping: an industry can raise caution, never lower it.
 */
export const INDUSTRY_RISK_DEFAULTS: Record<string, RiskPosture> = {
  "banking-financial-services": "conservative",
  "professional-services": "conservative",
  "healthcare-wellness": "conservative",
  "public-sector": "conservative",
};

/**
 * Derive the industry-default posture from what onboarding already knows. Prefers
 * the canonical archetype category (StorefrontConfig.archetype.category — the
 * single source of truth for industry per AGENTS.md §2), falling back to the
 * freeform industry string. Card handling nudges one step toward caution (PCI
 * exposure), never away. Returns the posture + provenance so the seed can record
 * that this was machine-derived, not operator-chosen.
 */
export function deriveRiskPostureDefault(input: {
  archetypeCategory?: string | null;
  industry?: string | null;
  handlesCardPayments?: boolean | null;
}): { posture: RiskPosture; source: "industry-default" } {
  const raw = input.archetypeCategory ?? input.industry ?? null;
  const key = raw != null && raw.trim() !== "" ? toFloorKey(raw) : null;
  let posture: RiskPosture =
    (key != null ? INDUSTRY_RISK_DEFAULTS[key] : undefined) ?? DEFAULT_RISK_POSTURE;
  // Card handling only ever raises caution.
  if (input.handlesCardPayments && posture === "balanced") posture = "conservative";
  return { posture, source: "industry-default" };
}

/**
 * The autonomy envelope a posture implies. Qualitative on purpose — P1 calibrates
 * the concrete thresholds when it wires each consumer; these ordinals are the
 * stable contract those consumers read.
 */
export type RiskEnvelope = {
  posture: RiskPosture;
  /** Default HITL stance for consequential agent decisions. */
  hitlDefault: "all-consequential" | "selective" | "minimal";
  /** Self-upgrade maintenance-window width. */
  selfUpgradeWindow: "narrow" | "standard" | "flexible";
  /** Whether `recommended` capabilities auto-activate vs are merely proposed. */
  capabilityAutoActivate: boolean;
  /** Outbound-send confirmation strictness. */
  outboundConfirmation: "always" | "first-time" | "trusted";
  /** Default edge-node customer-deployment opt-in. */
  edgeDeployDefault: boolean;
  /** Trust-dial autonomy ceiling (how far autonomy can rise on evidence). */
  autonomyCeiling: "low" | "moderate" | "high";
  /** How fast the trust dial matures toward its ceiling. */
  maturationRate: "slow" | "standard" | "fast";
};

const ENVELOPES: Record<RiskPosture, Omit<RiskEnvelope, "posture">> = {
  conservative: {
    hitlDefault: "all-consequential",
    selfUpgradeWindow: "narrow",
    capabilityAutoActivate: false,
    outboundConfirmation: "always",
    edgeDeployDefault: false,
    autonomyCeiling: "low",
    maturationRate: "slow",
  },
  balanced: {
    hitlDefault: "selective",
    selfUpgradeWindow: "standard",
    capabilityAutoActivate: true,
    outboundConfirmation: "first-time",
    edgeDeployDefault: false,
    autonomyCeiling: "moderate",
    maturationRate: "standard",
  },
  progressive: {
    hitlDefault: "minimal",
    selfUpgradeWindow: "flexible",
    capabilityAutoActivate: true,
    outboundConfirmation: "trusted",
    edgeDeployDefault: true,
    autonomyCeiling: "high",
    maturationRate: "fast",
  },
};

/** Resolve the envelope for a posture, falling back to the balanced default for
 *  an unset/invalid value. Accepts a raw `string` (e.g. the DB column) on
 *  purpose — it's fail-open and guards with isRiskPosture, mirroring the
 *  retention floor reader. */
export function resolveRiskEnvelope(posture: string | null | undefined): RiskEnvelope {
  const p = isRiskPosture(posture) ? posture : DEFAULT_RISK_POSTURE;
  return { posture: p, ...ENVELOPES[p] };
}

// ─── P1 consumer: decision-perspective autonomy policy ──────────────────────
// The live "trust dial" in practice is the decision-perspective evaluator, which
// reads the org WWWD profile's autonomyPolicy to gate how autonomously coworkers
// may act. This maps a posture to that policy. BALANCED IS THE IDENTITY: it
// reproduces exactly the policy the org profile is seeded with today
// (seed-org-wwwd-corpus DEFAULT_AUTONOMY_POLICY), so existing installs are
// unchanged. Conservative only tightens (more escalation, never arbitrate);
// progressive only loosens within bounds (arbitrate low+medium risk at high
// confidence). High/critical-risk decisions ALWAYS escalate regardless (an
// unconditional rule in the evaluator), so no posture can make an agent reckless
// on a high-risk call.

/** Identity policy — MUST equal seed-org-wwwd-corpus DEFAULT_AUTONOMY_POLICY. */
const BALANCED_AUTONOMY_POLICY: DecisionAutonomyPolicy = {
  allowRecommendation: true,
  allowArbitration: false,
  maxRiskForArbitration: "low",
  minimumConfidenceForRecommendation: 0.55,
  minimumConfidenceForArbitration: 0.9,
};

const AUTONOMY_POLICIES: Record<RiskPosture, DecisionAutonomyPolicy> = {
  conservative: {
    allowRecommendation: true,
    allowArbitration: false,
    maxRiskForArbitration: "low",
    minimumConfidenceForRecommendation: 0.65,
    minimumConfidenceForArbitration: 0.95,
  },
  balanced: BALANCED_AUTONOMY_POLICY,
  progressive: {
    allowRecommendation: true,
    allowArbitration: true,
    maxRiskForArbitration: "medium",
    minimumConfidenceForRecommendation: 0.5,
    minimumConfidenceForArbitration: 0.8,
  },
};

/** Map a risk envelope to the org's decision-perspective autonomy policy. */
export function riskEnvelopeToAutonomyPolicy(envelope: RiskEnvelope): DecisionAutonomyPolicy {
  return AUTONOMY_POLICIES[envelope.posture] ?? BALANCED_AUTONOMY_POLICY;
}
