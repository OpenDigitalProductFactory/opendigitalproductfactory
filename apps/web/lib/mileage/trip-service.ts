// lib/mileage/trip-service.ts — persistence for captured drives (BI-6D98AD8A,
// BI-E17E0034, EP-MILEAGE-ABSORB).
//
// The mileage substrate and its pure rules shipped without a write path, so
// nothing could actually record a drive. This module is that path, kept behind a
// STRUCTURAL client (the same shape lib/hr/payroll-run.ts uses) so the rules are
// unit-testable without a database and the "use server" layer stays a thin
// wrapper.
//
// Two invariants are enforced here rather than left to callers:
//
//   1. NO CAPTURE WITHOUT CONSENT. A trip may only be recorded for a driver
//      holding a granted DriverLocationConsent. This is the difference between
//      mileage tracking and surveillance, and it must not be a UI-layer promise.
//   2. MONETISE ONCE. A trip already carrying an expenseItemId is never priced
//      again, so re-running a period cannot pay a driver twice for one drive.

import { priceTrips, type PriceableTrip, type PricingResult } from "./monetisation";
import { normaliseCountryCode, type ResolvableRate } from "./rates";
import type { TripClassification } from "./classification";

/**
 * Wire-safe shape a client can send. Server actions cross a serialization
 * boundary, so timestamps arrive as ISO strings and are parsed server-side
 * rather than trusted as Date instances.
 */
export type RecordTripPayload = {
  vehicleId?: string | null;
  startedAt: string;
  endedAt: string;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  startPlaceLabel?: string | null;
  endPlaceLabel?: string | null;
  distanceMeters: number;
  captureKind: "automatic" | "manual" | "imported";
  /**
   * ISO 3166-1 alpha-2 the CAPTURING DEVICE derived from its own location.
   * Never a driver choice and never a server guess — omitted when the device
   * could not resolve one, which prices the trip on the driver's country of
   * record instead (DI-5E5AFE040A1F).
   */
  countryCode?: string | null;
};

export type RecordTripInput = {
  employeeProfileId: string;
  vehicleId?: string | null;
  startedAt: Date;
  endedAt: Date;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  startPlaceLabel?: string | null;
  endPlaceLabel?: string | null;
  distanceMeters: number;
  captureKind: "automatic" | "manual" | "imported";
  /** ISO 3166-1 alpha-2 the capturing device derived; see RecordTripPayload. */
  countryCode?: string | null;
};

/** Why a drive was refused. Closed set — a caller must be able to explain it. */
export type RecordTripRefusal =
  | "no_consent"
  | "consent_revoked"
  | "invalid_distance"
  | "invalid_interval";

export type RecordTripOutcome =
  | { recorded: true; tripId: string }
  | { recorded: false; refusal: RecordTripRefusal; detail: string };

/** The narrow slice of Prisma this service needs. Satisfied by PrismaClient. */
export type TripServiceClient = {
  driverLocationConsent: {
    findFirst(args: unknown): Promise<{ consentStatus: string; revokedAt: Date | null } | null>;
  };
  trip: {
    create(args: unknown): Promise<{ tripId: string }>;
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    update(args: unknown): Promise<unknown>;
  };
  organization: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
};

function nextTripId(seed: string): string {
  return `TRIP-${seed}`;
}

/**
 * Record one captured drive, refusing rather than recording when consent is
 * absent. Refusal is returned as data — a driver whose capture is refused needs
 * to be told why, not shown a stack trace.
 */
export async function recordTrip(
  db: TripServiceClient,
  input: RecordTripInput,
  idSeed: string,
): Promise<RecordTripOutcome> {
  if (!Number.isFinite(input.distanceMeters) || input.distanceMeters <= 0) {
    return {
      recorded: false,
      refusal: "invalid_distance",
      detail: "a drive must cover a positive distance",
    };
  }
  if (input.endedAt.getTime() <= input.startedAt.getTime()) {
    return {
      recorded: false,
      refusal: "invalid_interval",
      detail: "a drive must end after it starts",
    };
  }

  const consent = await db.driverLocationConsent.findFirst({
    where: { employeeProfileId: input.employeeProfileId },
    orderBy: { updatedAt: "desc" },
  });

  if (!consent) {
    return {
      recorded: false,
      refusal: "no_consent",
      detail: "no location-capture consent on record for this driver",
    };
  }
  if (consent.consentStatus !== "granted" || consent.revokedAt !== null) {
    return {
      recorded: false,
      refusal: "consent_revoked",
      detail: `consent is "${consent.consentStatus}" — capture is not permitted`,
    };
  }

  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    return {
      recorded: false,
      refusal: "no_consent",
      detail: "no organization exists to own the trip",
    };
  }

  const tripId = nextTripId(idSeed);
  await db.trip.create({
    data: {
      tripId,
      organizationId: org.id,
      employeeProfileId: input.employeeProfileId,
      vehicleId: input.vehicleId ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      startLatitude: input.startLatitude,
      startLongitude: input.startLongitude,
      endLatitude: input.endLatitude,
      endLongitude: input.endLongitude,
      startPlaceLabel: input.startPlaceLabel ?? null,
      endPlaceLabel: input.endPlaceLabel ?? null,
      distanceMeters: Math.round(input.distanceMeters),
      captureKind: input.captureKind,
      countryCode: normaliseCountryCode(input.countryCode),
    },
  });

  return { recorded: true, tripId };
}

/**
 * Set a trip's classification and record WHO decided.
 *
 * classifiedByKind is not decoration: a rule must never overwrite a human, and
 * the only way a later rule pass can honour that is if the trip says a person
 * chose this.
 */
export async function setTripClassification(
  db: TripServiceClient,
  tripId: string,
  classification: TripClassification,
  by: "driver" | "admin",
  now: Date,
): Promise<void> {
  await db.trip.update({
    where: { tripId },
    data: { classification, classifiedByKind: by, classifiedAt: now },
  });
}

export type MonetisationOutcome = {
  pricing: PricingResult;
  /** Trips skipped because they were already on a claim. */
  alreadyMonetised: string[];
};

/**
 * Price a period's unmonetised business trips.
 *
 * Trips already carrying an expenseItemId are excluded BEFORE pricing and
 * reported separately, so re-running a period is safe and visibly idempotent
 * rather than quietly producing a second claim for the same drives.
 */
export async function monetisePeriod(
  db: TripServiceClient,
  args: {
    employeeProfileId: string;
    periodStart: Date;
    periodEnd: Date;
    rates: readonly ResolvableRate[];
    currency?: string;
    /**
     * The driver's country of record. Governs any trip whose own country the
     * device could not derive, or which was driven somewhere the org holds no
     * rate plan (DI-5E5AFE040A1F).
     */
    employeeCountryCode?: string | null;
  },
): Promise<MonetisationOutcome> {
  const rows = await db.trip.findMany({
    where: {
      employeeProfileId: args.employeeProfileId,
      startedAt: { gte: args.periodStart, lte: args.periodEnd },
      lifecycle: "active",
    },
    orderBy: { startedAt: "asc" },
  });

  const alreadyMonetised: string[] = [];
  const priceable: PriceableTrip[] = [];

  for (const row of rows) {
    const tripId = String(row.tripId);
    if (row.expenseItemId) {
      alreadyMonetised.push(tripId);
      continue;
    }
    priceable.push({
      id: String(row.id),
      tripId,
      startedAt: row.startedAt as Date,
      distanceMetres: Number(row.distanceMeters),
      classification: row.classification as TripClassification,
      startPlaceLabel: (row.startPlaceLabel as string | null) ?? null,
      endPlaceLabel: (row.endPlaceLabel as string | null) ?? null,
      customerAccountId: (row.customerAccountId as string | null) ?? null,
      countryCode: (row.countryCode as string | null) ?? null,
    });
  }

  return {
    pricing: priceTrips(priceable, args.rates, args.currency ?? "USD", args.employeeCountryCode),
    alreadyMonetised,
  };
}
