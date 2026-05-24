// apps/web/lib/gear-interface/index.ts
//
// Reduction Gear Phase 0 — public surface for the gear-interface library.
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md

export type {
  GearInterfaceInput,
  InterfaceClass,
  TransmissionDirection,
  ShaftSourceType,
  ActorType,
  OutcomeType,
  SlipReason,
  AutonomyTier,
  GraderType,
  ExternalCounterpartyType,
} from "./types";

export {
  emitGearInterface,
  deriveIdempotencyKey,
  validateGearInterfaceInput,
  GearInterfaceValidationError,
  type EmitResult,
} from "./writer";

export {
  emitRing12FromCompletedPhase,
  loadPhaseOutcomeSignals,
} from "./emit-ring-1-2";

export {
  isOtelExportEnabled,
  buildOtelAttributes,
  buildOtelSpanName,
  type GearInterfaceRow,
} from "./otel-exporter";

export {
  defaultWindow,
  getInterfaceTorqueReadings,
  getSlipByReason,
  getTripleWearReadings,
  getRecentGraduations,
  listRecentGearInterfaceRows,
  getGearInterfaceRowById,
  type QueryWindow,
  type RingInterface,
  type InterfaceFilter,
  type InterfaceTorqueReading,
  type SlipByReason,
  type TripleWearReading,
  type GraduationEvent,
  type GearRowSummary,
} from "./query";
