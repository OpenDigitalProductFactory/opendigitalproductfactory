// apps/web/lib/gear-interface/source-adapters/promotion.ts
//
// Reduction Gear Phase 0 — Promotion → GearInterface adapter (CONTRACT STUB).
//
// GitPromotionCandidate / ChangePromotion / ProductVersion / ReleaseBundle
// drive Ring 3→4 (Archetype → Sandbox/Production) outward records on promotion
// and Ring 4↔5 records when release manifests cross the install boundary
// (governed-upgrade Phase 2 — see spec §9.9).
//
// Phase 0 does NOT emit. This is the typed contract for Phase 1+ wiring.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.3, §9.9

import type { GearInterfaceInput } from "../types";

export interface PromotionSource {
  id: string;
  /** "GitPromotionCandidate" | "ChangePromotion" | "ProductVersion" | "ReleaseBundle" */
  promotionKind: string;
  archetypeContext: string;
  agentId: string;
  success: boolean;
  recordedAt: Date;
}

export function promotionToRing34Input(
  source: PromotionSource,
  options: { organizationId?: string | null } = {},
): GearInterfaceInput {
  const torqueTechnical = source.success ? 1.0 : 0.0;

  return {
    interfaceClass: "internal-adjacent",
    transmissionDirection: "outward",
    innerRing: 3,
    outerRing: 4,
    shaftSourceType: "promotion",
    shaftSourceId: source.id,
    sourceEventAt: source.recordedAt,
    actorType: "system",
    actorId: source.agentId,
    intent: `promote:${source.promotionKind}`,
    capabilityName: `promotion:${source.promotionKind}`,
    capabilityVocabularyVersion: "raw-v0",
    archetypeContext: source.archetypeContext,
    agentIdForTriple: source.agentId,
    torqueTechnical,
    torqueConfidence: 0.9,
    ratioConsumed: 1,
    outcomeType: source.success ? "transmission" : "slip",
    slipDetected: !source.success,
    slipReason: source.success ? null : "failed-outcome",
    graderType: "runtime-check",
    organizationId: options.organizationId ?? null,
  };
}
