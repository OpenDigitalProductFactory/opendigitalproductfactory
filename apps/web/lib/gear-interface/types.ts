// apps/web/lib/gear-interface/types.ts
//
// Reduction Gear Phase 0 — GearInterface input shapes and enum literals.
//
// Adapters (source-adapters/*) produce GearInterfaceInput; the writer service
// validates, derives the idempotency key, and upserts. Enum literals are
// duplicated here as TypeScript string-literal unions because Prisma stores
// them as plain strings (the DB CHECK constraints enforce membership).
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §3.1
// BI:   BI-85CB31F0

export type InterfaceClass =
  | "internal-adjacent"
  | "external-federated"
  | "external-bridged"
  | "external-customer";

export type TransmissionDirection = "outward" | "inward" | "lateral";

export type ShaftSourceType =
  | "tool-execution"
  | "phase-run"
  | "capsule"
  | "promotion"
  | "feature-pack"
  | "a2a-thread"
  | "deliberation"
  | "runtime-verification"
  | "decision-interaction"
  | "external-po"
  | "external-invoice"
  | "external-handoff"
  | "platform-upgrade-run"
  | "release-manifest"
  | "channel-manifest"
  | "migration-classifier"
  | "seed-delta-manifest";

export type ActorType = "agent" | "human" | "system";

export type OutcomeType =
  | "transmission"
  | "slip"
  | "graduation"
  | "veto"
  | "calibration-update";

export type SlipReason =
  | "novel-context"
  | "failed-outcome"
  | "human-override"
  | "cost-overrun"
  | "safety-block"
  | "rate-limit"
  | "capability-gap"
  | "migration-destructive"
  | "manifest-invalid"
  | "signature-invalid"
  | "seed-delta-conflict"
  | "source-unindexed";

export type AutonomyTier =
  | "hitl-required"
  | "hitl-fallback"
  | "auto-confirm"
  | "auto-silent";

export type GraderType = "human" | "automated" | "deliberation" | "runtime-check";

export type ExternalCounterpartyType =
  | "supplier"
  | "partner"
  | "customer"
  | "peer-install";

/**
 * Normalized input an adapter produces for the writer service.
 *
 * The writer derives `idempotencyKey` from these fields when not provided
 * explicitly. Adapters MAY pass `idempotencyKeySuffix` when one source event
 * produces multiple GearInterface rows (e.g., a single phase emitting both a
 * transmission and a graduation), to disambiguate the otherwise-identical key.
 */
export interface GearInterfaceInput {
  // Location of the transmission
  interfaceClass: InterfaceClass;
  transmissionDirection?: TransmissionDirection;
  innerRing?: number | null;
  outerRing?: number | null;
  externalCounterpartyType?: ExternalCounterpartyType | null;
  externalCounterpartyId?: string | null;

  // Source event
  shaftSourceType: ShaftSourceType;
  shaftSourceId: string;
  sourceEventAt?: Date | null;
  actorType: ActorType;
  actorId: string;
  actorPrincipalId?: string | null;
  intent: string;

  // Capability triple
  capabilityName: string;
  capabilityVocabularyVersion?: string;
  archetypeContext?: string | null;
  agentIdForTriple: string;

  // Mechanical readings
  torqueTechnical: number;
  torqueValue?: number | null;
  torqueConfidence: number;
  ratioConsumed: number;
  outcomeType: OutcomeType;
  slipDetected?: boolean;
  slipReason?: SlipReason | null;

  // Cost
  costUsd?: number | string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  reasoningOutputTokens?: number | null;
  durationMs?: number | null;

  // Autonomy / graduation
  graduationFromAutonomy?: AutonomyTier | null;
  graduationToAutonomy?: AutonomyTier | null;
  graduationSampleSize?: number | null;
  graduationGovernorRef?: string | null;

  // Provenance
  graderType: GraderType;
  graderId?: string | null;
  rationale?: string | null;

  // OTel correlation (optional)
  otelTraceId?: string | null;
  otelSpanId?: string | null;

  // Org scoping (optional; single-org installs may pass null)
  organizationId?: string | null;

  /** Optional suffix when one source event emits multiple rows. */
  idempotencyKeySuffix?: string;

  /**
   * Explicit override. Most callers should let the writer derive this from the
   * other fields — the documented format is the contract. Pass only when the
   * derived key would collide with another legitimate row.
   */
  idempotencyKey?: string;
}
