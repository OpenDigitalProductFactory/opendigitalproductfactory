// apps/web/lib/gear-interface/source-adapters/runtime-verification.ts
//
// Reduction Gear Phase 0 — RuntimeVerification → GearInterface adapter (CONTRACT STUB).
//
// RuntimeVerification is the typed verification event that already attaches to
// RuntimeTarget / Workroom / FeatureBuild / GitPromotionCandidate. It will
// drive Ring 3→4 (Archetype → Sandbox/Production) outward records and Ring 4→5
// inward records (release verification arriving back at the install).
//
// Phase 0 does NOT emit production records here. The contract is captured as a
// typed adapter so the writer's invariant checks (archetypeContext required at
// Ring 2→3 and beyond) are exercised by tests. Production emission unlocks in
// Phase 1+ once archetype context resolution lands.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.3, §4.4

import type { GearInterfaceInput } from "../types";

export interface RuntimeVerificationSource {
  id: string;
  verificationId: string;
  kind: string;
  status: string;
  runtimeTargetId: string | null;
  featureBuildId: string | null;
  gitPromotionCandidateId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Resolved archetype id from the surrounding entity — REQUIRED for Ring 2→3+. */
  archetypeContext: string;
  /** Agent that performed or initiated the verification. */
  agentId: string;
}

export function runtimeVerificationToRing34Input(
  source: RuntimeVerificationSource,
  options: { organizationId?: string | null } = {},
): GearInterfaceInput {
  const torqueTechnical = source.status === "pass" || source.status === "complete" ? 1.0 : 0.0;

  return {
    interfaceClass: "internal-adjacent",
    transmissionDirection: "outward",
    innerRing: 3,
    outerRing: 4,
    shaftSourceType: "runtime-verification",
    shaftSourceId: source.id,
    sourceEventAt: source.completedAt ?? source.startedAt,
    actorType: "system",
    actorId: source.agentId,
    intent: `verify:${source.kind}`,
    capabilityName: `runtime-verification:${source.kind}`,
    capabilityVocabularyVersion: "raw-v0",
    archetypeContext: source.archetypeContext,
    agentIdForTriple: source.agentId,
    torqueTechnical,
    torqueConfidence: 0.9,
    ratioConsumed: 1,
    outcomeType: torqueTechnical >= 1.0 ? "transmission" : "slip",
    slipDetected: torqueTechnical < 1.0,
    slipReason: torqueTechnical < 1.0 ? "failed-outcome" : null,
    durationMs:
      source.startedAt && source.completedAt
        ? source.completedAt.getTime() - source.startedAt.getTime()
        : null,
    graderType: "runtime-check",
    organizationId: options.organizationId ?? null,
  };
}
