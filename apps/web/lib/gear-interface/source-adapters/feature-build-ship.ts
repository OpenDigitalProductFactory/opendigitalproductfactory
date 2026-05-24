// apps/web/lib/gear-interface/source-adapters/feature-build-ship.ts
//
// Reduction Gear Phase 1 — Ring 2→3 (Workflow → Archetype) emitter.
//
// Spec §4.2: "Every shipped FeatureBuild emits GearInterface with
// archetypeContext populated (resolved from StorefrontArchetype.id or
// archetypeCategories on the related entity)."
//
// This is the "biggest internal leak" the spec calls out — sealing it means
// HVAC wins start elevating HVAC-context autonomy, not generic averaged-
// across-verticals autonomy.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.2
// BI:   BI-861C4959

import type { GearInterfaceInput } from "../types";

export interface FeatureBuildShipSource {
  /** FeatureBuild.id — used as the canonical shaftSourceId. */
  id: string;
  buildId: string;
  title: string;
  /** Resolved archetype id from the active StorefrontConfig.archetypeId. REQUIRED at Ring 2→3. */
  archetypeContext: string;
  /** Coworker who claimed / led the build. Falls back to codingProvider when null. */
  claimedByAgentId: string | null;
  codingProvider: string | null;
  /** Did the build actually ship cleanly? Drives torqueTechnical. */
  shipSucceeded: boolean;
  /** Optional acceptance signal — true when downstream verification confirmed value. */
  acceptanceMet: boolean | null;
  /** When the ship phase completed. */
  completedAt: Date;
  /**
   * How many Ring 1→2 events fed this Ring 2→3 advance. Phase 1 default is the
   * count of phase runs (5 for a full lifecycle); callers can pass the exact
   * count when known.
   */
  ringRatioConsumed?: number;
}

/**
 * Compose a Ring 2→3 outward GearInterfaceInput from a shipped FeatureBuild.
 *
 * Torque math:
 *   - shipSucceeded && acceptanceMet === true → 1.0
 *   - shipSucceeded && acceptanceMet null (unknown) → 0.75 (partial — outcome attribution deferred)
 *   - shipSucceeded && acceptanceMet === false → 0.25 (shipped but rejected downstream)
 *   - !shipSucceeded → 0.0
 *
 * Confidence:
 *   - acceptanceMet has an explicit value → 0.9
 *   - acceptanceMet null → 0.6 (we know it shipped, not whether it landed)
 */
export function featureBuildShipToRing23Input(
  source: FeatureBuildShipSource,
  options: { organizationId?: string | null } = {},
): GearInterfaceInput {
  let torqueTechnical: number;
  let torqueConfidence: number;
  let slipReason: GearInterfaceInput["slipReason"] = null;

  if (!source.shipSucceeded) {
    torqueTechnical = 0;
    torqueConfidence = 0.95;
    slipReason = "failed-outcome";
  } else if (source.acceptanceMet === true) {
    torqueTechnical = 1.0;
    torqueConfidence = 0.9;
  } else if (source.acceptanceMet === false) {
    torqueTechnical = 0.25;
    torqueConfidence = 0.9;
    slipReason = "failed-outcome";
  } else {
    torqueTechnical = 0.75;
    torqueConfidence = 0.6;
  }

  const agentIdForTriple =
    source.claimedByAgentId ??
    source.codingProvider ??
    `unknown-agent:${source.buildId}`;

  return {
    interfaceClass: "internal-adjacent",
    transmissionDirection: "outward",
    innerRing: 2,
    outerRing: 3,
    shaftSourceType: "phase-run",
    shaftSourceId: `${source.id}-ship`,
    sourceEventAt: source.completedAt,
    actorType: "agent",
    actorId: agentIdForTriple,
    intent: "ship-feature-build",
    capabilityName: "feature-build-ship",
    capabilityVocabularyVersion: "raw-v0",
    archetypeContext: source.archetypeContext, // REQUIRED at Ring 2→3 per writer invariants
    agentIdForTriple,
    torqueTechnical,
    torqueConfidence,
    ratioConsumed: source.ringRatioConsumed ?? 5, // 5 phases per default lifecycle
    outcomeType: torqueTechnical >= 0.5 ? "transmission" : "slip",
    slipDetected: torqueTechnical < 0.5,
    slipReason,
    graderType: "automated",
    graderId: "feature-build-ship.completePhase",
    organizationId: options.organizationId ?? null,
  };
}
