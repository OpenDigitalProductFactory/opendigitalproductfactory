// GET  /api/v1/mileage/trips — the signed-in driver's own captured drives.
// POST /api/v1/mileage/trips — record one drive. Refused without consent.

// @exposure authenticated

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";
import { TRIP_SELECT, requireDriverProfileId, toMileageTripSummary } from "@/lib/api/mileage";
import { recordTrip } from "@/lib/mileage/trip-service";
import { newId } from "@/lib/shared/new-id";
import type { RecordTripRequest } from "@dpf/types";

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);
    const driverId = await requireDriverProfileId(user.id);

    const url = new URL(request.url);
    const { limit } = parsePagination(url.searchParams);

    const rows = await prisma.trip.findMany({
      where: { employeeProfileId: driverId, lifecycle: "active" },
      orderBy: { startedAt: "desc" },
      take: limit + 1,
      select: TRIP_SELECT,
    });

    const page = buildPaginatedResponse(rows, limit);
    return apiSuccess({
      data: page.data.map(toMileageTripSummary),
      nextCursor: page.nextCursor,
    });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticateRequest(request);
    const driverId = await requireDriverProfileId(user.id);
    const body = (await request.json()) as RecordTripRequest;

    const outcome = await recordTrip(
      prisma as never,
      {
        employeeProfileId: driverId,
        vehicleId: body.vehicleId ?? null,
        startedAt: new Date(body.startedAt),
        endedAt: new Date(body.endedAt),
        startLatitude: body.startLatitude,
        startLongitude: body.startLongitude,
        endLatitude: body.endLatitude,
        endLongitude: body.endLongitude,
        startPlaceLabel: body.startPlaceLabel ?? null,
        endPlaceLabel: body.endPlaceLabel ?? null,
        distanceMeters: body.distanceMetres,
        captureKind: body.captureKind,
        countryCode: body.countryCode ?? null,
      },
      newId(),
    );

    if (!outcome.recorded) {
      // A refusal is a 403, not a 500 — the client must show the driver WHY,
      // and a consent refusal is an expected state, not a server fault.
      throw new ApiError("CAPTURE_REFUSED", outcome.detail, 403, {
        refusal: outcome.refusal,
      });
    }

    const row = await prisma.trip.findUniqueOrThrow({
      where: { tripId: outcome.tripId },
      select: TRIP_SELECT,
    });
    return apiSuccess(toMileageTripSummary(row), 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
