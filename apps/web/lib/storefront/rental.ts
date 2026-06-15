// Rental / shared-asset value-stream registry + pure capacity helpers.
// EP-ARCH-8D4F2A · BI-EEA24A34 Phase 3.
//
// Canonical home for the rental string-enum unions (mirrored in the Prisma
// schema as plain string columns, per AGENTS.md §3 — hyphens, never
// underscores) and the capacity math that powers availability, utilization,
// and self-storage occupancy. Helpers are PURE: they take plain rows so they
// can be unit-tested without a database and reused by server actions, the
// daily board, and the equitable-rationing scheduler.

// ── Enum registry ────────────────────────────────────────────────────────────

export const RENTABLE_UNIT_STATUSES = [
  "available",
  "reserved",
  "out",
  "returned",
  "maintenance",
  "retired",
] as const;
export type RentableUnitStatus = (typeof RENTABLE_UNIT_STATUSES)[number];

export const RENTAL_AGREEMENT_STATUSES = [
  "reserved",
  "verified",
  "active",
  "returned",
  "closed",
  "cancelled",
] as const;
export type RentalAgreementStatus = (typeof RENTAL_AGREEMENT_STATUSES)[number];

export const RENTAL_VERIFICATION_STATUSES = [
  "not-required",
  "pending",
  "verified",
  "failed",
] as const;
export type RentalVerificationStatus =
  (typeof RENTAL_VERIFICATION_STATUSES)[number];

export const RENTAL_CONDITION_PHASES = ["checkout", "return"] as const;
export type RentalConditionPhase = (typeof RENTAL_CONDITION_PHASES)[number];

export const RENTAL_PRICING_MODELS = [
  "per-day",
  "per-week",
  "usage-based",
  "fixed",
] as const;
export type RentalPricingModel = (typeof RENTAL_PRICING_MODELS)[number];

/** Agreement statuses that occupy capacity (hold a unit / pool slot). */
export const OCCUPYING_AGREEMENT_STATUSES: readonly RentalAgreementStatus[] = [
  "reserved",
  "verified",
  "active",
];

/** Unit statuses that count as on-shelf and rentable right now. */
export const RENTABLE_UNIT_AVAILABLE_STATUSES: readonly RentableUnitStatus[] = [
  "available",
];

// ── Capacity helpers ─────────────────────────────────────────────────────────

export interface AgreementPeriod {
  status: RentalAgreementStatus;
  periodStart: Date;
  periodEnd: Date;
  rentableUnitId?: string | null;
}

/** Half-open overlap: [aStart, aEnd) intersects [bStart, bEnd). */
export function periodsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Count agreements occupying capacity for a class over a requested window.
 * Only occupying statuses (reserved/verified/active) and genuine overlaps count.
 */
export function countOverlappingAgreements(
  agreements: readonly AgreementPeriod[],
  windowStart: Date,
  windowEnd: Date,
): number {
  return agreements.filter(
    (a) =>
      OCCUPYING_AGREEMENT_STATUSES.includes(a.status) &&
      periodsOverlap(a.periodStart, a.periodEnd, windowStart, windowEnd),
  ).length;
}

export interface ClassAvailabilityInput {
  /** Pool capacity for a quantity-pool class (serialized classes pass 0). */
  stockQuantity: number;
  /** Count of serialized RentableUnits in an available status (0 for pool). */
  serializedAvailableUnits: number;
  /** Whether the class is serialized (has individual units) or a quantity pool. */
  serialized: boolean;
  agreements: readonly AgreementPeriod[];
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Available capacity for a class over a window.
 * - Serialized class: count of units in an available status (units are the
 *   source of truth; overlapping agreements already drove the unit out of
 *   `available`, so they are not double-subtracted).
 * - Quantity-pool class: stockQuantity − overlapping occupying agreements.
 * Never returns a negative number.
 */
export function availableCapacity(input: ClassAvailabilityInput): number {
  if (input.serialized) {
    return Math.max(0, input.serializedAvailableUnits);
  }
  const taken = countOverlappingAgreements(
    input.agreements,
    input.windowStart,
    input.windowEnd,
  );
  return Math.max(0, input.stockQuantity - taken);
}

export function isClassAvailable(input: ClassAvailabilityInput): boolean {
  return availableCapacity(input) > 0;
}

/**
 * Utilization fraction (0..1) of a pool at a point in time: occupying
 * agreements overlapping `at` divided by total capacity. Capacity of 0 → 0.
 */
export function utilizationRate(
  agreements: readonly AgreementPeriod[],
  totalCapacity: number,
  at: Date,
): number {
  if (totalCapacity <= 0) return 0;
  // Point sample: a 1ms probe window so an agreement covering `at` registers
  // (periodsOverlap is half-open, so a zero-width window never intersects).
  const probeEnd = new Date(at.getTime() + 1);
  const occupied = countOverlappingAgreements(agreements, at, probeEnd);
  return Math.min(1, occupied / totalCapacity);
}

/**
 * Self-storage occupancy %: occupied units / total units, expressed 0..100.
 * Unlike utilization (a point-in-time rate over a pool), occupancy is a
 * standing snapshot of the unit inventory — the storage industry's headline KPI.
 */
export function occupancyPercent(
  totalUnits: number,
  occupiedUnits: number,
): number {
  if (totalUnits <= 0) return 0;
  return Math.min(100, Math.round((occupiedUnits / totalUnits) * 100));
}

export interface UnitConflictInput {
  rentableUnitId: string;
  agreements: readonly AgreementPeriod[];
  windowStart: Date;
  windowEnd: Date;
  /** Exclude this agreement id (e.g. when re-checking an existing reservation). */
  ignoreAgreementRef?: string;
}

/**
 * True when a serialized unit is double-booked for the window — any occupying
 * agreement bound to the same unit whose period overlaps. The reservation
 * guard for serialized fleet (BookingHold covers the optimistic-concurrency
 * window; this is the durable check at confirm time).
 */
export function hasUnitConflict(input: UnitConflictInput): boolean {
  return input.agreements.some(
    (a) =>
      a.rentableUnitId === input.rentableUnitId &&
      OCCUPYING_AGREEMENT_STATUSES.includes(a.status) &&
      periodsOverlap(
        a.periodStart,
        a.periodEnd,
        input.windowStart,
        input.windowEnd,
      ),
  );
}

/** Whole-day span (inclusive of both ends) for per-day pricing. */
export function rentalDays(periodStart: Date, periodEnd: Date): number {
  const ms = periodEnd.getTime() - periodStart.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
