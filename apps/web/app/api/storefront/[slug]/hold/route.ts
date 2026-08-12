import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import crypto from "crypto";
import { apiErrorResponse } from "@/lib/api/error";
import { isExclusionViolation } from "@/lib/db/exclusion-violation";
import {
  allocateHospitalityCapacity,
  resolveHospitalityResourceForProvider,
} from "@/lib/storefront/hospitality-capacity-repository.server";
import { HospitalityCapacityConflictError } from "@/lib/storefront/hospitality-capacity";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await req.json();
  const { itemId, providerId, slotStart, slotEnd } = body as {
    itemId: string;
    providerId?: string;
    slotStart: string;
    slotEnd: string;
  };

  if (!itemId || !slotStart || !slotEnd) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      "itemId, slotStart, and slotEnd are required",
      400,
    );
  }

  // Find storefront
  const storefront = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug }, isPublished: true },
    select: {
      id: true,
      organizationId: true,
      archetype: { select: { archetypeId: true } },
    },
  });
  if (!storefront) {
    return apiErrorResponse("NOT_FOUND", "Storefront not found", 404);
  }

  const now = new Date();
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  // Rate limit: max 50 concurrent active holds per storefront
  const globalCount = await prisma.bookingHold.count({
    where: { storefrontId: storefront.id, expiresAt: { gt: now } },
  });
  if (globalCount >= 50) {
    const response = apiErrorResponse(
      "RATE_LIMITED",
      "Too many active holds",
      429,
    );
    response.headers.set("Retry-After", "60");
    return response;
  }

  // Rate limit: max 3 active holds per IP per storefront
  const ipCount = await prisma.bookingHold.count({
    where: {
      storefrontId: storefront.id,
      holderIp: clientIp,
      expiresAt: { gt: now },
    },
  });
  if (ipCount >= 3) {
    const response = apiErrorResponse(
      "RATE_LIMITED",
      "Too many active holds from this client",
      429,
    );
    response.headers.set("Retry-After", "60");
    return response;
  }

  const slotStartDate = new Date(slotStart);
  const slotEndDate = new Date(slotEnd);
  if (
    !Number.isFinite(slotStartDate.getTime()) ||
    !Number.isFinite(slotEndDate.getTime()) ||
    slotEndDate <= slotStartDate
  ) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      "slotEnd must be after a valid slotStart",
      400,
    );
  }

  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  try {
    const hold = await prisma.$transaction(async (tx) => {
      const item = await tx.storefrontItem.findFirst({
        where: { id: itemId, storefrontId: storefront.id, isActive: true },
        select: { id: true },
      });
      if (!item) throw new Error("STOREFRONT_ITEM_NOT_FOUND");

      const resource = providerId
        ? await resolveHospitalityResourceForProvider(tx as never, {
            organizationId: storefront.organizationId,
            storefrontId: storefront.id,
            providerId,
          })
        : null;

      if (storefront.archetype?.archetypeId === "restaurant" && !resource) {
        throw new Error("RESTAURANT_TABLE_REQUIRED");
      }

      // Non-hospitality providers retain the compatibility hold check. A
      // structured resource skips this raceable preflight: its allocation
      // exclusion constraint is the atomic arbiter.
      if (providerId && !resource) {
        const conflict = await tx.bookingHold.findFirst({
          where: {
            storefrontId: storefront.id,
            providerId,
            expiresAt: { gt: now },
            slotStart: { lt: slotEndDate },
            slotEnd: { gt: slotStartDate },
          },
        });
        if (conflict) throw new Error("LEGACY_HOLD_CONFLICT");
      }

      const holderToken = crypto.randomUUID();
      const created = await tx.bookingHold.create({
        data: {
          organizationId: storefront.organizationId,
          storefrontId: storefront.id,
          itemId,
          providerId: providerId ?? null,
          hospitalityResourceId: resource?.id ?? null,
          slotStart: slotStartDate,
          slotEnd: slotEndDate,
          holderToken,
          holderIp: clientIp,
          expiresAt,
        },
        select: { id: true, holderToken: true, expiresAt: true },
      });

      if (resource) {
        await allocateHospitalityCapacity(tx as never, {
          organizationId: storefront.organizationId,
          storefrontId: storefront.id,
          resourceId: resource.id,
          poolId: null,
          demandType: "hold",
          demandRef: created.holderToken,
          bookingId: null,
          bookingHoldId: created.id,
          startsAt: slotStartDate,
          endsAt: slotEndDate,
          quantity: 1,
          idempotencyKey: `hold:${created.id}`,
        });
      }
      return created;
    });

    return NextResponse.json(
      { holderToken: hold.holderToken, expiresAt: hold.expiresAt },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof HospitalityCapacityConflictError ||
      isExclusionViolation(error) ||
      (error instanceof Error && error.message === "LEGACY_HOLD_CONFLICT")
    ) {
      return apiErrorResponse(
        "CAPACITY_CONFLICT",
        "Slot is already held",
        409,
      );
    }
    if (
      error instanceof Error &&
      error.message === "RESTAURANT_TABLE_REQUIRED"
    ) {
      return apiErrorResponse(
        "CAPACITY_CONFIGURATION_REQUIRED",
        "That table is not available for reservations. Please choose another time.",
        409,
      );
    }
    if (
      error instanceof Error &&
      error.message === "STOREFRONT_ITEM_NOT_FOUND"
    ) {
      return apiErrorResponse(
        "NOT_FOUND",
        "Storefront item not found",
        404,
      );
    }
    throw error;
  }
}
