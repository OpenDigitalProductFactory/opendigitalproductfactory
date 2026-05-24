// apps/web/lib/gear-interface/governor/graduation.ts
//
// Reduction Gear Phase 1 — graduation event emission.
//
// When `consult()` returns a result with graduationEligible=true, the caller
// invokes `emitGraduation()` to write the durable record. The Cockpit's
// graduations panel renders the row; the operator can veto via the veto
// affordance which emits a separate `outcomeType='veto'` row that links back
// by graduationGovernorRef.
//
// We deliberately separate consult() (read) from emitGraduation() (write) so
// the Governor can be safely consulted without side effects. Phase 2 surfaces
// (e.g. an Inngest reconciler) decide WHEN to act on consult results.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6.4

import { emitGearInterface } from "../writer";
import type { CalibrationKey } from "../calibrator";
import type { GovernorConsultResult } from "./index";
import { NEXT_TIER } from "./thresholds";

export interface EmitGraduationInput {
  triple: CalibrationKey;
  consult: GovernorConsultResult;
  /**
   * Unique reference to the persisted Governor decision — used by the veto
   * flow to find the graduation row and emit a paired veto. Phase 1 lets the
   * caller pass a string id (e.g. DecisionInteraction id when WWMD is wired,
   * or a synthetic `gov-{shortid}` until then).
   */
  governorRef: string;
  /** Optional override of the rationale on the emitted row. */
  rationaleOverride?: string;
}

/**
 * Emit a graduation GearInterface row for a triple the Governor approved to
 * elevate. Returns null when the consult was not graduation-eligible — callers
 * can safely await this with no-op semantics. Idempotent via the writer's
 * deterministic key derivation.
 */
export async function emitGraduation(input: EmitGraduationInput) {
  const { consult } = input;
  if (!consult.graduationEligible) return null;

  const currentTier = input.triple.autonomyLevel ?? "hitl-required";
  const nextTier = NEXT_TIER[currentTier];
  if (!nextTier) return null;

  return emitGearInterface({
    interfaceClass: input.triple.interfaceClass,
    transmissionDirection: "outward",
    innerRing: input.triple.innerRing,
    outerRing: input.triple.outerRing,
    shaftSourceType: "decision-interaction",
    shaftSourceId: input.governorRef,
    sourceEventAt: new Date(),
    actorType: "system",
    actorId: "autonomy-governor",
    intent: "graduate-autonomy",
    capabilityName: input.triple.capabilityName,
    capabilityVocabularyVersion: "raw-v0",
    archetypeContext: input.triple.archetypeContext,
    agentIdForTriple: input.triple.agentIdForTriple,
    torqueTechnical: consult.trust.score ?? 1.0,
    torqueConfidence: consult.trust.confidence,
    ratioConsumed: 1,
    outcomeType: "graduation",
    graduationFromAutonomy: currentTier,
    graduationToAutonomy: nextTier,
    graduationSampleSize: consult.trust.sampleSize,
    graduationGovernorRef: input.governorRef,
    graderType: "deliberation",
    rationale: input.rationaleOverride ?? consult.rationale,
  });
}

/**
 * Emit a veto row that pairs with a prior graduation by governorRef. The
 * cooldown semantics — does the triple permanently lose access, or is there a
 * timeout — live in Governor policy per spec §11(9) (deferred decision).
 * Phase 1 records the veto; cooldown enforcement lands when the policy is set.
 */
export interface EmitVetoInput {
  triple: CalibrationKey;
  /** governorRef of the graduation row being vetoed. */
  governorRef: string;
  /** Which operator issued the veto — surfaces as actorId. */
  operatorId: string;
  rationale: string;
}

export async function emitVeto(input: EmitVetoInput) {
  const currentTier = input.triple.autonomyLevel ?? "hitl-required";
  return emitGearInterface({
    interfaceClass: input.triple.interfaceClass,
    transmissionDirection: "outward",
    innerRing: input.triple.innerRing,
    outerRing: input.triple.outerRing,
    shaftSourceType: "decision-interaction",
    // Suffix the source id so the veto row gets its own idempotency key but
    // still references the original governorRef for join queries.
    shaftSourceId: `${input.governorRef}-veto`,
    sourceEventAt: new Date(),
    actorType: "human",
    actorId: input.operatorId,
    intent: "veto-graduation",
    capabilityName: input.triple.capabilityName,
    archetypeContext: input.triple.archetypeContext,
    agentIdForTriple: input.triple.agentIdForTriple,
    // Veto reflects operator judgment, not the triple's torque — record the
    // veto as a 0-torque slip so wear queries notice it.
    torqueTechnical: 0,
    torqueConfidence: 1.0,
    ratioConsumed: 1,
    outcomeType: "veto",
    slipDetected: true,
    slipReason: "human-override",
    // Keep the from/to tiers so the Cockpit can show "vetoed an X→Y elevation"
    graduationFromAutonomy: currentTier,
    graduationToAutonomy: currentTier, // veto cancels the elevation — tier stays put
    graduationGovernorRef: input.governorRef,
    graderType: "human",
    graderId: input.operatorId,
    rationale: input.rationale,
  });
}
