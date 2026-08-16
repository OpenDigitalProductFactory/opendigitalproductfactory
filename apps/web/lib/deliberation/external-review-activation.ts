// apps/web/lib/deliberation/external-review-activation.ts
//
// BI-A245FE00 / EP-BUILD-65837F — autonomous cross-surface deliberation for
// EXTERNAL-surface artifacts.
//
// Founder insight (Mark, 2026-06-26): independent cross-LLM review materially
// improves quality (this study's own design was corrected by an independent
// codex-desktop review that caught three errors a single model missed). That is
// the diversity-of-thought / reviewer-not-author pattern, and the Golden Triangle
// is the governance dial that decides WHEN the added Cost + Time of a second
// independent reviewer is worth the Quality.
//
// The deliberation ENGINE already exists (start_deliberation: review/debate over
// an artifact, a stage/risk activation resolver, a strategyProfile cost/quality
// dial, budget + branch breadth, async dispatch). It is wired to Build Studio
// artifacts but NOT to the external host-CLI surfaces — so today a human
// controller routes a review by hand. This module is the missing activation
// POLICY: given an artifact authored on an external surface, decide whether to
// fire an independent-surface deliberation and with what golden-triangle profile.
//
// PURE (no DB): the caller supplies the artifact descriptor. Wiring this into the
// capsule/evidence-recording path and the start_deliberation dispatch (selecting
// an independent surface, enforcing the budget) is the follow-up slice.

export type DeliberationArtifactType =
  | "spec"
  | "plan"
  | "code-change"
  | "architecture-decision"
  | "policy"
  | "research-question";
export type DeliberationRisk = "low" | "medium" | "high" | "critical";
export type DeliberationPattern = "review" | "debate";
export type StrategyProfile = "economy" | "balanced" | "high-assurance" | "document-authority";

export interface ExternalArtifact {
  readonly artifactType: DeliberationArtifactType;
  /** Workroom executorKind of the authoring surface (e.g. claude-desktop). */
  readonly authorSurface: string;
  readonly risk?: DeliberationRisk;
  /** Deliverable-sensitivity floor — can only RAISE the profile, never lower it. */
  readonly sensitivityFloor?: StrategyProfile;
}

export interface ActivationDecision {
  readonly activate: boolean;
  readonly pattern: DeliberationPattern;
  readonly strategyProfile: StrategyProfile;
  readonly risk: DeliberationRisk;
  readonly reason: string;
}

const RISK_ORDER: Record<DeliberationRisk, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const PROFILE_ORDER: Record<StrategyProfile, number> = {
  economy: 0,
  balanced: 1,
  "high-assurance": 2,
  "document-authority": 3,
};

function riskToProfile(risk: DeliberationRisk): StrategyProfile {
  switch (risk) {
    case "critical":
      return "document-authority";
    case "high":
      return "high-assurance";
    case "medium":
      return "balanced";
    case "low":
      return "economy";
  }
}

/** Apply the deliverable-sensitivity floor: the floor can only RAISE the profile. */
function applyFloor(profile: StrategyProfile, floor?: StrategyProfile): StrategyProfile {
  if (!floor) return profile;
  return PROFILE_ORDER[floor] > PROFILE_ORDER[profile] ? floor : profile;
}

/**
 * Minimum risk at which each artifact type warrants an independent deliberation.
 * Doctrine-shaping artifacts always warrant one; code/plan only as risk rises
 * (normal CI + author review covers the low-risk tail).
 */
const MIN_ACTIVATION_RISK: Record<DeliberationArtifactType, DeliberationRisk | null> = {
  "architecture-decision": "low", // always
  policy: "low", // always
  spec: "medium",
  plan: "medium",
  "code-change": "high",
  "research-question": "high",
};

/**
 * Decide whether an external-surface artifact should fire an independent-surface
 * deliberation, and with what golden-triangle profile. `strategyProfile` is the
 * Golden Triangle dial (more assurance = more Cost+Time for Quality), selected
 * from risk and raised — never lowered — by the deliverable-sensitivity floor.
 */
export function decideExternalReviewActivation(artifact: ExternalArtifact): ActivationDecision {
  const risk = artifact.risk ?? "medium";
  const threshold = MIN_ACTIVATION_RISK[artifact.artifactType];
  const activate = threshold !== null && RISK_ORDER[risk] >= RISK_ORDER[threshold];
  const strategyProfile = applyFloor(riskToProfile(risk), artifact.sensitivityFloor);
  // Debate (adversarial, multi-position) for the highest-stakes doctrine work;
  // peer review otherwise.
  const pattern: DeliberationPattern =
    risk === "critical" &&
    (artifact.artifactType === "architecture-decision" || artifact.artifactType === "policy")
      ? "debate"
      : "review";
  const reason = activate
    ? `${artifact.artifactType} at risk=${risk} >= ${threshold} -> ${pattern} (${strategyProfile})`
    : `${artifact.artifactType} at risk=${risk} below activation threshold ${threshold ?? "n/a"} -> no independent review`;
  return { activate, pattern, strategyProfile, risk, reason };
}

/**
 * Pick a reviewing surface INDEPENDENT of the author. Governance approves
 * evidence, not provenance, so any surface other than the author can review.
 * Returns null when no independent surface is available (caller falls back to
 * the operator or a same-surface second pass).
 */
export function pickIndependentSurface(
  authorSurface: string,
  availableSurfaces: readonly string[],
): string | null {
  const independent = availableSurfaces.filter((s) => s !== authorSurface);
  return independent[0] ?? null;
}
