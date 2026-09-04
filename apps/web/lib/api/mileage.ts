// Shared projection + driver resolution for the /api/v1/mileage routes.
//
// Kept out of the route files so the list, record and classify handlers cannot
// drift in how they shape a drive or decide whose drive it is.

import { prisma } from "@dpf/db";
import { ApiError } from "@/lib/api/error";
import type { MileageTripSummary } from "@dpf/types";

export const TRIP_SELECT = {
  // `id` is required by buildPaginatedResponse's cursor contract; it is never
  // projected to the client, which addresses a drive by its semantic tripId.
  id: true,
  tripId: true,
  startedAt: true,
  endedAt: true,
  distanceMeters: true,
  classification: true,
  classifiedByKind: true,
  startPlaceLabel: true,
  endPlaceLabel: true,
  reimbursableAmount: true,
  currency: true,
  expenseItemId: true,
} as const;

type TripRow = {
  id: string;
  tripId: string;
  startedAt: Date;
  endedAt: Date;
  distanceMeters: number;
  classification: string;
  classifiedByKind: string | null;
  startPlaceLabel: string | null;
  endPlaceLabel: string | null;
  reimbursableAmount: unknown;
  currency: string;
  expenseItemId: string | null;
};

export function toMileageTripSummary(row: TripRow): MileageTripSummary {
  return {
    tripId: row.tripId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    distanceMetres: row.distanceMeters,
    classification: row.classification as MileageTripSummary["classification"],
    classifiedBy: (row.classifiedByKind as MileageTripSummary["classifiedBy"]) ?? null,
    startPlaceLabel: row.startPlaceLabel,
    endPlaceLabel: row.endPlaceLabel,
    // Null stays null. A drive with no rate yet is NOT a drive worth nothing.
    reimbursableAmount:
      row.reimbursableAmount === null ? null : Number(row.reimbursableAmount),
    currency: row.currency,
    claimed: row.expenseItemId !== null,
  };
}

/**
 * The employee record behind the authenticated user.
 *
 * Every mileage route resolves the driver this way rather than trusting a
 * client-supplied id — otherwise one employee could file drives, and claim
 * reimbursement, against another's record.
 */
export async function requireDriverProfileId(userId: string): Promise<string> {
  const profile = await prisma.employeeProfile.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (!profile) {
    throw new ApiError(
      "NO_EMPLOYEE_RECORD",
      "Your account is not linked to an employee record, so drives cannot be recorded against it.",
      409,
    );
  }
  return profile.id;
}
