"use server";

// Server actions for mileage capture and reimbursement (EP-MILEAGE-ABSORB).
//
// The mileage substrate, rules and pricing all merged without a write path, so
// nothing could record a drive. These are the thin wrappers over
// lib/mileage/trip-service.ts that make it reachable.
//
// Per AGENTS.md §6 this module exports functions only — the input types live in
// lib/mileage/trip-service.ts so a client can import them without pulling a
// server module.
//
// SECURITY: recordTripAction resolves the driver from the SESSION, never from
// client input. Accepting an employeeProfileId from the caller would let one
// employee file drives — and claim reimbursement — against another's record.

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireCapability, requireCapabilityContext, requireUser } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { newId } from "@/lib/shared/new-id";
import { employeeCountryOfRecord } from "@/lib/mileage/country-of-record";
import {
  monetisePeriod,
  recordTrip,
  setTripClassification,
  type RecordTripPayload,
} from "@/lib/mileage/trip-service";
import type { ResolvableRate } from "@/lib/mileage/rates";
import {
  recordCompanyMileageRate,
  recordManualDrive,
  type ManualEntryDb,
} from "@/lib/mileage/manual-entry";
import type { TripClassification } from "@/lib/mileage/classification";

const MILEAGE_PATH = "/finance/mileage";

/** The signed-in user's employee profile, or null when they have none. */
async function currentEmployeeProfileId(): Promise<string | null> {
  const user = await requireUser();
  const profile = await prisma.employeeProfile.findFirst({
    where: { userId: user.id },
    select: { id: true },
  });
  return profile?.id ?? null;
}

/** Record one captured drive for the signed-in driver. */
export async function recordTripAction(
  payload: RecordTripPayload,
): Promise<ActionResult<{ tripId: string }>> {
  const employeeProfileId = await currentEmployeeProfileId();
  if (!employeeProfileId) {
    return err("Your user account is not linked to an employee record, so drives cannot be recorded.");
  }

  const outcome = await recordTrip(
    prisma as never,
    {
      employeeProfileId,
      vehicleId: payload.vehicleId ?? null,
      startedAt: new Date(payload.startedAt),
      endedAt: new Date(payload.endedAt),
      startLatitude: payload.startLatitude,
      startLongitude: payload.startLongitude,
      endLatitude: payload.endLatitude,
      endLongitude: payload.endLongitude,
      startPlaceLabel: payload.startPlaceLabel ?? null,
      endPlaceLabel: payload.endPlaceLabel ?? null,
      distanceMeters: payload.distanceMeters,
      captureKind: payload.captureKind,
      countryCode: payload.countryCode ?? null,
    },
    newId(),
  );

  if (!outcome.recorded) return err(outcome.detail);

  revalidatePath(MILEAGE_PATH);
  return ok({ tripId: outcome.tripId });
}

/** Classify a drive. A driver may only classify their own. */
export async function classifyTripAction(
  tripId: string,
  classification: TripClassification,
): Promise<ActionResult> {
  const employeeProfileId = await currentEmployeeProfileId();
  if (!employeeProfileId) return err("No employee record is linked to your account.");

  const trip = await prisma.trip.findUnique({
    where: { tripId },
    select: { employeeProfileId: true },
  });
  if (!trip) return err("That drive no longer exists.");
  if (trip.employeeProfileId !== employeeProfileId) {
    return err("You can only classify your own drives.");
  }

  await setTripClassification(prisma as never, tripId, classification, "driver", new Date());
  revalidatePath(MILEAGE_PATH);
  return ok();
}

/**
 * Price a driver's business drives for a period onto an expense claim.
 *
 * Finance capability, not the driver's own — turning drives into money owed is
 * an approval act. The claim, its items and the trip links are written in ONE
 * transaction so a partial failure cannot leave trips marked as claimed against
 * a claim that does not exist.
 */
export async function monetiseMileageAction(input: {
  employeeProfileId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<ActionResult<{ claimId: string; total: number; skipped: number; alreadyClaimed: number }>> {
  await requireCapability("manage_finance");

  const employee = await prisma.employeeProfile.findUnique({
    where: { id: input.employeeProfileId },
    select: { id: true, displayName: true },
  });
  if (!employee) return err("That employee record no longer exists.");

  const rateRows = await prisma.mileageRate.findMany({
    where: { plan: { lifecycle: "active" } },
    include: {
      plan: {
        select: {
          isOrgOverride: true,
          // The plan's country is what lets a trip driven abroad price on that
          // country's policy rather than the employee's home rate.
          jurisdictionReference: { select: { countryCode: true } },
        },
      },
    },
  });
  const rates: ResolvableRate[] = rateRows.map((r) => ({
    id: r.id,
    purposeKind: r.purposeKind as ResolvableRate["purposeKind"],
    amountPerMile: Number(r.amountPerMile),
    currency: r.currency,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    isOrgOverride: r.plan.isOrgOverride,
    jurisdictionCountryCode: r.plan.jurisdictionReference?.countryCode ?? null,
  }));

  if (rates.length === 0) {
    return err("No mileage rate is configured, so drives cannot be priced yet.");
  }

  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);

  const employeeCountryCode = await employeeCountryOfRecord(prisma as never, employee.id);

  const outcome = await monetisePeriod(prisma as never, {
    employeeProfileId: employee.id,
    periodStart,
    periodEnd,
    rates,
    employeeCountryCode,
  });

  if (outcome.pricing.lines.length === 0) {
    // Distinguish "already paid" from "nothing qualified" — an operator who
    // re-runs a period needs to know the drives were claimed, not lost.
    if (outcome.alreadyMonetised.length > 0) {
      return err(
        `Those ${outcome.alreadyMonetised.length} drive(s) are already on an expense claim.`,
      );
    }
    return err("No unclaimed business drives in that period — nothing to reimburse.");
  }

  const claimId = `EXP-MIL-${periodStart.toISOString().slice(0, 7)}-${employee.id.slice(-6)}`;

  const created = await prisma.$transaction(async (tx) => {
    const claim = await tx.expenseClaim.create({
      data: {
        claimId,
        employeeId: employee.id,
        status: "submitted",
        title: `Mileage — ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
        totalAmount: outcome.pricing.totalAmount,
        currency: outcome.pricing.currency,
        submittedAt: new Date(),
      },
      select: { id: true, claimId: true },
    });

    let sortOrder = 0;
    for (const line of outcome.pricing.lines) {
      const item = await tx.expenseItem.create({
        data: {
          claimId: claim.id,
          date: line.date,
          category: "mileage",
          description: line.description,
          amount: line.amount,
          currency: line.currency,
          sortOrder: sortOrder++,
        },
        select: { id: true },
      });
      // Link the trip to its item so the drive can never be priced twice.
      await tx.trip.update({
        where: { tripId: line.tripId },
        data: { expenseItemId: item.id, mileageRateId: line.mileageRateId },
      });
    }

    return claim;
  });

  revalidatePath(MILEAGE_PATH);
  revalidatePath("/finance/expense-claims");

  return ok({
    claimId: created.claimId,
    total: outcome.pricing.totalAmount,
    skipped: outcome.pricing.skipped.length,
    alreadyClaimed: outcome.alreadyMonetised.length,
  });
}

// ── Portal entry (BI-3DD6EFEB) ──────────────────────────────────────────────
// Before these, no rate could be set and no drive could be typed in, so the
// claim below always refused. The rules live in lib/mileage/manual-entry.ts.

const manualEntryDb = prisma as unknown as ManualEntryDb;

/**
 * Set the company's per-mile reimbursement rate. Finance capability; the actor
 * comes from the session so the automation persona is recognised and refused.
 */
export async function recordMileageRateAction(input: {
  amountPerMile: number;
  effectiveFrom: string;
  sourceUrl: string;
}): Promise<ActionResult<{ mileageRateId: string }>> {
  const { userId, email } = await requireCapabilityContext("manage_finance");
  const result = await recordCompanyMileageRate(
    manualEntryDb,
    { ...input, actor: { userId, email }, now: new Date() },
    newId(),
  );
  if (result.ok) revalidatePath(MILEAGE_PATH);
  return result;
}

/** Record a drive the signed-in driver typed in. The driver comes from the session. */
export async function recordManualDriveAction(input: {
  date: string;
  fromLabel: string;
  toLabel: string;
  miles: number;
  purpose: string;
}): Promise<ActionResult<{ tripId: string }>> {
  const employeeProfileId = await currentEmployeeProfileId();
  if (!employeeProfileId) {
    return err("Your user account is not linked to an employee record, so drives cannot be recorded.");
  }
  const result = await recordManualDrive(manualEntryDb, { ...input, employeeProfileId }, new Date(), newId());
  if (result.ok) revalidatePath(MILEAGE_PATH);
  return result;
}

/** Claim the signed-in driver's own business drives for a period. */
export async function claimMyMileageAction(input: {
  periodStart: string;
  periodEnd: string;
}): Promise<ActionResult<{ claimId: string; total: number; skipped: number; alreadyClaimed: number }>> {
  // Stated here as well as inside monetiseMileageAction, so the authorization
  // of this entry point is visible without reading the action it delegates to.
  await requireCapability("manage_finance");
  const employeeProfileId = await currentEmployeeProfileId();
  if (!employeeProfileId) return err("No employee record is linked to your account.");
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(input.periodStart) || !day.test(input.periodEnd) || input.periodEnd < input.periodStart) {
    return err("Choose a start and end date, with the end on or after the start.");
  }
  // Whole days, in UTC like the drives themselves: the end day's drives count.
  return monetiseMileageAction({
    employeeProfileId,
    periodStart: `${input.periodStart}T00:00:00.000Z`,
    periodEnd: `${input.periodEnd}T23:59:59.999Z`,
  });
}
