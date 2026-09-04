// @exposure public

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { readActivationProfile } from "@dpf/storefront-templates";

import { auth } from "@/lib/auth";
import {
  OccupancyCommandError,
  placeResourceOccupant,
  releaseResourceOccupant,
  type OccupancyClient,
} from "@/lib/resource-scheduling/resource-occupancy";

function errorResponse(error: unknown) {
  if (error instanceof OccupancyCommandError) {
    const status = ["animal_not_found", "resource_not_found", "placement_not_found"].includes(error.code)
      ? 404
      : 409;
    return NextResponse.json({ code: error.code, message: error.message }, { status });
  }
  throw error;
}

function validDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ code: "unauthorized", message: "Unauthorized" }, { status: 401 });
  }
  const config = await prisma.storefrontConfig.findFirst({
    select: { organizationId: true, archetype: { select: { activationProfile: true } } },
  });
  const activation = readActivationProfile(config?.archetype.activationProfile);
  const allowedKinds = activation?.processProfile.resourceKinds
    .filter((kind) => ["kennel", "foster-home"].includes(kind.kindSlug) && kind.capacityUnit === "animals")
    .map((kind) => kind.kindSlug) ?? [];
  if (!config || allowedKinds.length === 0) {
    return NextResponse.json({ code: "housing_not_configured", message: "Housing is not configured." }, { status: 404 });
  }
  const body = (await request.json()) as Record<string, unknown>;
  try {
    if (body.action === "place") {
      const placedAt = validDate(body.placedAt);
      if (!placedAt || typeof body.animalRef !== "string" || typeof body.destinationResourceId !== "string") {
        return NextResponse.json({ code: "invalid_request", message: "Animal, destination, and placement time are required." }, { status: 400 });
      }
      const placement = await placeResourceOccupant({
        db: prisma as unknown as OccupancyClient,
        organizationId: config.organizationId,
        allowedKinds,
        command: {
          animalRef: body.animalRef,
          destinationResourceId: body.destinationResourceId,
          placedAt,
          idempotencyKey: String(body.idempotencyKey ?? ""),
        },
      });
      return NextResponse.json({ placement });
    }
    if (body.action === "release") {
      const releasedAt = validDate(body.releasedAt);
      if (!releasedAt || typeof body.allocationId !== "string" || typeof body.expectedResourceId !== "string") {
        return NextResponse.json({ code: "invalid_request", message: "Current placement and release time are required." }, { status: 400 });
      }
      const placement = await releaseResourceOccupant({
        db: prisma as unknown as OccupancyClient,
        organizationId: config.organizationId,
        command: {
          allocationId: body.allocationId,
          expectedResourceId: body.expectedResourceId,
          releasedAt,
          reason: String(body.reason ?? "left-care"),
          idempotencyKey: String(body.idempotencyKey ?? ""),
        },
      });
      return NextResponse.json({ placement });
    }
    return NextResponse.json({ code: "invalid_request", message: "Choose place or release." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
