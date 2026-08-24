// PATCH /api/v1/mileage/trips/[tripId] — classify one of the driver's drives.

// @exposure authenticated

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { TRIP_SELECT, requireDriverProfileId, toMileageTripSummary } from "@/lib/api/mileage";
import { setTripClassification } from "@/lib/mileage/trip-service";
import type { ClassifyTripRequest } from "@dpf/types";

const ALLOWED = new Set(["business", "personal", "commute"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const driverId = await requireDriverProfileId(user.id);
    const { tripId } = await params;
    const body = (await request.json()) as ClassifyTripRequest;

    if (!ALLOWED.has(body.classification)) {
      throw new ApiError("INVALID_CLASSIFICATION", "That classification is not allowed.", 400);
    }

    const trip = await prisma.trip.findUnique({
      where: { tripId },
      select: { employeeProfileId: true, expenseItemId: true },
    });
    if (!trip) throw new ApiError("NOT_FOUND", "That drive no longer exists.", 404);

    // Ownership is checked server-side; a driver may only classify their own.
    if (trip.employeeProfileId !== driverId) {
      throw new ApiError("FORBIDDEN", "You can only classify your own drives.", 403);
    }

    // A claimed drive priced a reimbursement — it is accounting evidence now,
    // and letting its classification drift from the claim would be a silent
    // mismatch between what was paid and what it was paid for.
    if (trip.expenseItemId !== null) {
      throw new ApiError(
        "ALREADY_CLAIMED",
        "That drive is already on an expense claim and cannot be reclassified.",
        409,
      );
    }

    await setTripClassification(prisma as never, tripId, body.classification, "driver", new Date());

    const row = await prisma.trip.findUniqueOrThrow({
      where: { tripId },
      select: TRIP_SELECT,
    });
    return apiSuccess(toMileageTripSummary(row));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
