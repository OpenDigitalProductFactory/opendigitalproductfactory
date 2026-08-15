import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { newId } from "@/lib/shared/new-id";
import {
  serializeRestaurantTableAttributes,
  validateRestaurantTableAttributesInput,
} from "@/lib/storefront/restaurant-table-attributes";

function validCapacity(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }
  const config = await prisma.storefrontConfig.findFirst({
    select: { id: true },
  });
  if (!config) return NextResponse.json({ resources: [] });

  const resources = await prisma.hospitalityResource.findMany({
    where: { storefrontId: config.id, kind: "table" },
    orderBy: [{ serviceArea: "asc" }, { label: "asc" }],
    select: {
      id: true,
      resourceId: true,
      label: true,
      kind: true,
      status: true,
      capacity: true,
      capacityUnit: true,
      serviceArea: true,
      blockedReason: true,
      attributes: true,
      version: true,
      availability: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          days: true,
          startTime: true,
          endTime: true,
          date: true,
          kind: true,
          reason: true,
        },
      },
    },
  });
  return NextResponse.json({
    resources: resources.map((resource) => ({
      ...resource,
      availability: resource.availability.map((row) => ({
        id: row.id,
        days: row.days,
        startTime: row.startTime ?? "00:00",
        endTime: row.endTime ?? "23:59",
        date: row.date?.toISOString() ?? null,
        isBlocked: row.kind === "blocked",
        reason: row.reason,
      })),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const body = (await request.json()) as {
    storefrontId?: string;
    label?: string;
    capacity?: number;
    serviceArea?: string | null;
    shape?: string;
    combinationGroup?: string | null;
    combinableWith?: unknown[];
    bookingAccess?: string;
  };
  const label = body.label?.trim();
  if (!body.storefrontId || !label || !validCapacity(body.capacity)) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      "storefrontId, table label, and 1–100 seats are required",
      400,
    );
  }
  const attributes = validateRestaurantTableAttributesInput({
    shape: body.shape ?? "round",
    combinationGroup: body.combinationGroup ?? null,
    combinableWith: body.combinableWith ?? [],
    bookingAccess: body.bookingAccess ?? "online",
  });
  if (!attributes.ok) {
    return apiErrorResponse("INVALID_ARGUMENT", attributes.error, 400);
  }

  const config = await prisma.storefrontConfig.findFirst({
    where: {
      id: body.storefrontId,
      archetype: { category: "food-hospitality" },
    },
    select: {
      id: true,
      organizationId: true,
      items: {
        where: { isActive: true, ctaType: "booking" },
        select: { id: true },
      },
    },
  });
  if (!config) {
    return apiErrorResponse(
      "NOT_FOUND",
      "Food & Hospitality storefront not found",
      404,
    );
  }

  const resource = await prisma.$transaction(async (transaction) => {
    // Compatibility projection for the existing slot engine. HospitalityResource
    // is authoritative; this human-shaped row is never rendered as Staff.
    const provider = await transaction.serviceProvider.create({
      data: {
        providerId: `SP-${newId(6).toUpperCase()}`,
        storefrontId: config.id,
        name: label,
        isActive: true,
      },
      select: { id: true },
    });
    if (config.items.length > 0) {
      await transaction.providerService.createMany({
        data: config.items.map((item) => ({
          providerId: provider.id,
          itemId: item.id,
        })),
        skipDuplicates: true,
      });
    }
    const created = await transaction.hospitalityResource.create({
      data: {
        resourceId: `HR-${newId(8).toUpperCase()}`,
        organizationId: config.organizationId,
        storefrontId: config.id,
        kind: "table",
        label,
        status: "active",
        capacity: body.capacity,
        capacityUnit: "seats",
        serviceArea: body.serviceArea?.trim() || null,
        attributes: serializeRestaurantTableAttributes(
          attributes.value,
        ) as Prisma.InputJsonValue,
        legacyServiceProviderId: provider.id,
      },
      select: {
        id: true,
        resourceId: true,
        label: true,
        kind: true,
        status: true,
        capacity: true,
        capacityUnit: true,
        serviceArea: true,
        blockedReason: true,
        attributes: true,
        version: true,
      },
    });
    return { ...created, availability: [] };
  });

  return NextResponse.json({ resource }, { status: 201 });
}
