// Closed-set unions for the controlled-substance custody schema
// (EP-CSC-CUSTODY). The Prisma enums in prisma/schema/controlled-substances.prisma
// are the source; controlled-substance-enums.test.ts fails if these drift.

export const CONTROLLED_SUBSTANCE_SCHEDULES = ["c_i", "c_ii", "c_ii_n", "c_iii", "c_iii_n", "c_iv", "c_v"] as const;
export type ControlledSubstanceSchedule = (typeof CONTROLLED_SUBSTANCE_SCHEDULES)[number];

export const CONTROLLED_SUBSTANCE_UNITS = ["tablet", "capsule", "milliliter", "milligram", "gram", "patch", "each"] as const;
export type ControlledSubstanceUnit = (typeof CONTROLLED_SUBSTANCE_UNITS)[number];

export const CONTROLLED_SUBSTANCE_HANDLER_SCOPES = [
  "receive",
  "administer",
  "dispense",
  "waste",
  "witness",
  "transfer",
  "destroy",
  "count",
  "reconcile",
] as const;
export type ControlledSubstanceHandlerScope = (typeof CONTROLLED_SUBSTANCE_HANDLER_SCOPES)[number];

export const CONTROLLED_SUBSTANCE_MOVEMENT_KINDS = [
  "receipt",
  "administration",
  "dispense",
  "waste",
  "return_to_supplier",
  "transfer_out",
  "transfer_in",
  "destruction",
  "loss_theft",
  "count_adjustment",
  "reversal",
] as const;
export type ControlledSubstanceMovementKind = (typeof CONTROLLED_SUBSTANCE_MOVEMENT_KINDS)[number];

export const CONTROLLED_SUBSTANCE_COUNT_KINDS = [
  "initial",
  "biennial",
  "state_annual",
  "periodic",
  "shift_change",
  "discrepancy_recount",
  "newly_controlled",
] as const;
export type ControlledSubstanceCountKind = (typeof CONTROLLED_SUBSTANCE_COUNT_KINDS)[number];

export const CONTROLLED_SUBSTANCE_COUNT_TIMINGS = ["opening_of_business", "close_of_business"] as const;
export type ControlledSubstanceCountTiming = (typeof CONTROLLED_SUBSTANCE_COUNT_TIMINGS)[number];

export const CONTROLLED_SUBSTANCE_COUNT_METHODS = ["exact", "estimated"] as const;
export type ControlledSubstanceCountMethod = (typeof CONTROLLED_SUBSTANCE_COUNT_METHODS)[number];

export const CONTROLLED_SUBSTANCE_DISCREPANCY_CLASSES = [
  "unclassified",
  "recording_error",
  "breakage_or_spill",
  "unexplained_variance",
  "suspected_theft",
  "significant_loss",
] as const;
export type ControlledSubstanceDiscrepancyClass = (typeof CONTROLLED_SUBSTANCE_DISCREPANCY_CLASSES)[number];

export const CONTROLLED_SUBSTANCE_DISCREPANCY_STATUSES = [
  "detected",
  "contained",
  "investigating",
  "adjustment_approved",
  "escalated",
  "reconciled",
  "closed",
] as const;
export type ControlledSubstanceDiscrepancyStatus = (typeof CONTROLLED_SUBSTANCE_DISCREPANCY_STATUSES)[number];
