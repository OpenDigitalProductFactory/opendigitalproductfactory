// lib/mileage/manual-entry.ts — the portal's two missing inputs to mileage
// reimbursement: the rate a person sets, and a drive a person types in
// (BI-3DD6EFEB).
//
// The substrate priced and monetised correctly and still could not pay anyone:
// nothing in the product created a MileageRate, and a drive could only arrive
// from the phone app with GPS coordinates. These two functions are the whole
// fix; pricing and claim creation stay in trip-service and the existing action.
//
// The rate is the COMPANY'S reimbursement rate (an org override plan, not
// scoped to a country). That is deliberate: a typed-in drive carries no device
// country, and an employee often has no country of record, so only an unscoped
// plan is guaranteed to price it (rates.ts resolveRateForTrip tier 3). Choosing
// to reimburse at the IRS rate is the company's policy decision; the source URL
// records where the figure came from.

import { isPlatformAutomationPersona } from "@/lib/govern/automation-persona-identity";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { METRES_PER_MILE } from "./rates";

export interface ManualEntryActor {
  userId: string;
  email: string | null;
}

/** The narrow slice of Prisma these functions need. */
export interface ManualEntryDb {
  organization: { findFirst(args: unknown): Promise<{ id: string } | null> };
  mileageRatePlan: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
  mileageRate: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
  trip: { create(args: unknown): Promise<{ tripId: string }> };
  $transaction<T>(fn: (tx: ManualEntryDb) => Promise<T>): Promise<T>;
}

/** A per-mile figure above this is a typo (cents typed as dollars), not a policy. */
const MAX_PLAUSIBLE_PER_MILE = 5;

/** A calendar date typed as YYYY-MM-DD, or null when it is not one. */
function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.trim() ? null : date;
}

function isWebSource(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function recordCompanyMileageRate(
  db: ManualEntryDb,
  input: {
    amountPerMile: number;
    effectiveFrom: string;
    sourceUrl: string;
    actor: ManualEntryActor;
    now: Date;
  },
  idSeed: string,
): Promise<ActionResult<{ mileageRateId: string }>> {
  // An agent signed in through a browser looks like a person to the action;
  // a reimbursement rate is a figure a person must have read and chosen.
  if (isPlatformAutomationPersona(input.actor.email)) {
    return err("A mileage rate must be entered by a person, not by an automated session.");
  }
  if (!Number.isFinite(input.amountPerMile) || input.amountPerMile <= 0) {
    return err("Enter the rate per mile as a positive amount, for example 0.70.");
  }
  if (input.amountPerMile > MAX_PLAUSIBLE_PER_MILE) {
    return err("That rate is too high for a per-mile figure. Enter it in currency units, for example 0.70, not 70.");
  }
  const effectiveFrom = parseCalendarDate(input.effectiveFrom);
  if (!effectiveFrom) return err("Enter the date the rate starts as YYYY-MM-DD.");
  if (!isWebSource(input.sourceUrl)) {
    return err("Add the web address of the page the rate comes from.");
  }

  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) return err("No organization exists to own the rate.");

  return db.$transaction(async (tx) => {
    const plan = (await tx.mileageRatePlan.findFirst({
      where: { organizationId: org.id, isOrgOverride: true, lifecycle: "active" },
      orderBy: { createdAt: "asc" },
    })) ?? (await tx.mileageRatePlan.create({
      data: {
        mileageRatePlanId: `MRP-${idSeed}`,
        organizationId: org.id,
        jurisdictionRefId: null,
        name: "Company mileage rate",
        isOrgOverride: true,
      },
    }));

    const clash = await tx.mileageRate.findFirst({
      where: { planId: plan.id, purposeKind: "business", effectiveFrom },
    });
    if (clash) {
      return err("A rate already starts on that date. Pick the date the new rate takes effect.");
    }

    const mileageRateId = `MRT-${idSeed}`;
    await tx.mileageRate.create({
      data: {
        mileageRateId,
        planId: plan.id,
        purposeKind: "business",
        amountPerMile: input.amountPerMile,
        currency: "USD",
        effectiveFrom,
        effectiveTo: null,
        sourceUrl: input.sourceUrl.trim(),
      },
    });
    return ok({ mileageRateId });
  });
}

export async function recordManualDrive(
  db: ManualEntryDb,
  input: {
    employeeProfileId: string;
    date: string;
    fromLabel: string;
    toLabel: string;
    miles: number;
    purpose: string;
  },
  now: Date,
  idSeed: string,
): Promise<ActionResult<{ tripId: string }>> {
  const day = parseCalendarDate(input.date);
  if (!day) return err("Enter the date of the drive as YYYY-MM-DD.");
  if (day.getTime() > now.getTime()) return err("A drive cannot be in the future.");
  if (!Number.isFinite(input.miles) || input.miles <= 0) return err("Enter the miles driven.");
  const from = input.fromLabel.trim();
  const to = input.toLabel.trim();
  const purpose = input.purpose.trim();
  if (!from || !to) return err("Enter where the drive started and where it went.");
  // The IRS log a reimbursement rests on needs the business purpose of every drive.
  if (!purpose) return err("Enter the business purpose of the drive.");

  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) return err("No organization exists to own the drive.");

  // Noon UTC: the day the driver typed stays that day in every time zone, which
  // matters because the drive prices at the rate in force on its date.
  const startedAt = new Date(day.getTime() + 12 * 60 * 60 * 1000);
  const endedAt = new Date(startedAt.getTime() + 60 * 1000);
  const tripId = `TRIP-${idSeed}`;

  await db.trip.create({
    data: {
      tripId,
      organizationId: org.id,
      employeeProfileId: input.employeeProfileId,
      startedAt,
      endedAt,
      // Typed in, not captured: the position is unknown, never 0,0.
      startLatitude: null,
      startLongitude: null,
      endLatitude: null,
      endLongitude: null,
      startPlaceLabel: from,
      endPlaceLabel: to,
      distanceMeters: Math.round(input.miles * METRES_PER_MILE),
      captureKind: "manual",
      classification: "business",
      classifiedByKind: "driver",
      classifiedAt: now,
      notes: purpose,
    },
  });
  return ok({ tripId });
}
