// apps/web/lib/gear-interface/source-adapters/feature-pack.ts
//
// Reduction Gear Phase 0 — FeaturePack → GearInterface adapter (CONTRACT STUB).
//
// FeaturePack is the existing Hive contribution artifact. In Phase 3 this
// adapter drives Ring 4↔5 outward records when contribute_to_hive runs and
// inward records when hive-scout-ingest pulls. Phase 0 does NOT emit production
// records — the adapter is a typed contract for Phase 3 implementation.
//
// Privacy note: per spec §7.1, raw torque histograms travel through the
// CalibratedCapabilityPack creation flow, which is governed by contribute_to_hive.
// This adapter never emits histogram payload — only the existence and outcome
// of the cross-install handshake.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.4, §7

import type { GearInterfaceInput } from "../types";

export interface FeaturePackContributionSource {
  id: string;
  /** Outward push from this install, or inward pull from another. */
  direction: "outward" | "inward";
  /** Pseudonymized identifier of the other install — never raw PII. */
  peerInstallPseudonym: string;
  agentId: string;
  archetypeContext: string;
  success: boolean;
  failureReason: string | null;
  recordedAt: Date;
}

export function featurePackToRing45Input(
  source: FeaturePackContributionSource,
  options: { organizationId?: string | null } = {},
): GearInterfaceInput {
  const torqueTechnical = source.success ? 1.0 : 0.0;

  return {
    interfaceClass: "external-federated",
    transmissionDirection: source.direction === "outward" ? "lateral" : "lateral",
    innerRing: null,
    outerRing: null,
    externalCounterpartyType: "peer-install",
    externalCounterpartyId: source.peerInstallPseudonym,
    shaftSourceType: "feature-pack",
    shaftSourceId: source.id,
    sourceEventAt: source.recordedAt,
    actorType: "agent",
    actorId: source.agentId,
    intent: source.direction === "outward" ? "contribute_to_hive" : "hive_scout_ingest",
    capabilityName: "hive-federation",
    capabilityVocabularyVersion: "raw-v0",
    archetypeContext: source.archetypeContext,
    agentIdForTriple: source.agentId,
    torqueTechnical,
    torqueConfidence: 0.95,
    ratioConsumed: 1,
    outcomeType: source.success ? "transmission" : "slip",
    slipDetected: !source.success,
    slipReason: source.success ? null : "failed-outcome",
    graderType: "runtime-check",
    rationale: source.failureReason,
    organizationId: options.organizationId ?? null,
  };
}
