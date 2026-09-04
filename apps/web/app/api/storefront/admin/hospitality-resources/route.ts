import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { readActivationProfile } from "@dpf/storefront-templates";

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { newId } from "@/lib/shared/new-id";
import {
  ADMIN_RESOURCE_ROSTER_LIMIT,
  assertAdminRosterWithinLimit,
  clonePublicId,
  isAdminResourceCapacityValid,
  resolveAdminResourceProfile,
} from "@/lib/resource-scheduling/admin-resource-profile";
import { upsertCanonicalResourceDraft } from "@/lib/resource-scheduling/admin-resource-repository";
import {
  cloneSourceRef,
  fromHospitalityResource,
} from "@/lib/resource-scheduling/clone-adapters";
import { mergeDualRead } from "@/lib/resource-scheduling/dual-read";
import {
  serializeRestaurantTableAttributes,
  validateRestaurantTableAttributesInput,
} from "@/lib/storefront/restaurant-table-attributes";

const ADMIN_RESOURCE_KIND = "table";

function legacyAvailabilityDto(
  rows: Array<{
    id: string;
    days: number[];
    startTime: string | null;
    endTime: string | null;
    date: Date | null;
    kind: string;
    reason: string | null;
  }>,
) {
  return rows.map((row) => ({
    id: row.id,
    days: row.days,
    startTime: row.startTime ?? "00:00",
    endTime: row.endTime ?? "23:59",
    date: row.date?.toISOString() ?? null,
    isBlocked: row.kind === "blocked",
    reason: row.reason,
  }));
}

function canonicalStatus(row: {
  lifecycle: string;
  lifecycleReason: string | null;
  blockedReason: string | null;
}): string {
  if (row.blockedReason) return "blocked";
  if (row.lifecycleReason?.startsWith("legacy-status:")) {
    return row.lifecycleReason.slice("legacy-status:".length);
  }
  return row.lifecycle === "active" ? "active" : row.lifecycle;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      organizationId: true,
      timezone: true,
      archetype: { select: { activationProfile: true } },
    },
  });
  if (!config) return NextResponse.json({ resources: [] });

  const activationProfile = readActivationProfile(
    config.archetype.activationProfile,
  );
  const adminProfile = resolveAdminResourceProfile(
    activationProfile?.processProfile,
    ADMIN_RESOURCE_KIND,
  );
  if (!adminProfile) {
    return apiErrorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }

  const [canonicalResources, legacyResources] = await Promise.all([
    prisma.resource.findMany({
      where: {
        storefrontId: config.id,
        organizationId: config.organizationId,
        domain: "hospitality",
        kindSlug: adminProfile.kindSlug,
      },
      orderBy: [{ serviceArea: "asc" }, { label: "asc" }],
      take: ADMIN_RESOURCE_ROSTER_LIMIT + 1,
      select: {
        id: true,
        resourceKey: true,
        label: true,
        kindSlug: true,
        lifecycle: true,
        lifecycleReason: true,
        capacity: true,
        capacityUnit: true,
        serviceArea: true,
        blockedReason: true,
        attributes: true,
        sourceRef: true,
        version: true,
        availability: {
          orderBy: { createdAt: "asc" },
          where: { lifecycle: "active" },
          select: {
            id: true,
            days: true,
            startTime: true,
            endTime: true,
            date: true,
            windowKind: true,
            reason: true,
            sourceRef: true,
          },
        },
      },
    }),
    prisma.hospitalityResource.findMany({
      where: { storefrontId: config.id, kind: adminProfile.kindSlug },
      orderBy: [{ serviceArea: "asc" }, { label: "asc" }],
      take: ADMIN_RESOURCE_ROSTER_LIMIT + 1,
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
    }),
  ]);

  const canonicalDtos = canonicalResources.map((resource) => ({
    id: clonePublicId(resource.sourceRef, "HospitalityResource", resource.id),
    resourceId: resource.resourceKey,
    label: resource.label,
    kind: resource.kindSlug,
    status: canonicalStatus(resource),
    capacity: resource.capacity,
    capacityUnit: resource.capacityUnit,
    serviceArea: resource.serviceArea,
    blockedReason: resource.blockedReason,
    attributes: resource.attributes,
    version: resource.version,
    sourceRef: resource.sourceRef,
    availability: resource.availability.map((row) => ({
      id: clonePublicId(
        row.sourceRef,
        "HospitalityResourceAvailability",
        row.id,
      ),
      days: row.days,
      startTime: row.startTime ?? "00:00",
      endTime: row.endTime ?? "23:59",
      date: row.date?.toISOString() ?? null,
      isBlocked: row.windowKind === "blocked",
      reason: row.reason,
    })),
  }));

  const merged = mergeDualRead({
    unified: canonicalDtos,
    legacy: legacyResources,
    legacySourceRef: (resource) => cloneSourceRef("HospitalityResource", resource.id),
    adapt: (resource) => ({
      ...resource,
      sourceRef: cloneSourceRef("HospitalityResource", resource.id),
      availability: legacyAvailabilityDto(resource.availability),
    }),
  });

  try {
    assertAdminRosterWithinLimit(merged.rows.length);
  } catch (error) {
    if (error instanceof Error && error.message === "RESOURCE_ROSTER_LIMIT") {
      return apiErrorResponse("INTERNAL_ERROR", "Internal server error", 500);
    }
    throw error;
  }

  return NextResponse.json({
    resources: merged.rows.map(({ sourceRef: _sourceRef, ...resource }) => resource),
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
  const config = await prisma.storefrontConfig.findFirst({
    where: {
      id: body.storefrontId,
      archetype: { category: "food-hospitality" },
    },
    select: {
      id: true,
      organizationId: true,
      timezone: true,
      archetype: { select: { activationProfile: true } },
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
  const activationProfile = readActivationProfile(
    config.archetype.activationProfile,
  );
  const adminProfile = resolveAdminResourceProfile(
    activationProfile?.processProfile,
    ADMIN_RESOURCE_KIND,
  );
  if (!adminProfile) {
    return apiErrorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
  if (
    !body.storefrontId ||
    !label ||
    !isAdminResourceCapacityValid(body.capacity, adminProfile)
  ) {
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
        kind: adminProfile.kindSlug,
        label,
        status: "active",
        capacity: body.capacity,
        capacityUnit: adminProfile.capacityUnit,
        serviceArea: body.serviceArea?.trim() || null,
        attributes: serializeRestaurantTableAttributes(
          attributes.value,
        ) as Prisma.InputJsonValue,
        legacyServiceProviderId: provider.id,
      },
      select: {
        id: true,
        resourceId: true,
        organizationId: true,
        storefrontId: true,
        label: true,
        kind: true,
        status: true,
        capacity: true,
        capacityUnit: true,
        serviceArea: true,
        blockedReason: true,
        attributes: true,
        version: true,
        legacyServiceProviderId: true,
      },
    });
    const { draft } = fromHospitalityResource(created);
    const canonicalData = {
      ...draft,
      attributes: draft.attributes as Prisma.InputJsonValue,
    };
    await upsertCanonicalResourceDraft(transaction.resource, canonicalData);
    const {
      organizationId: _organizationId,
      storefrontId: _storefrontId,
      legacyServiceProviderId: _legacyServiceProviderId,
      ...publicResource
    } = created;
    return { ...publicResource, availability: [] };
  });

  return NextResponse.json({ resource }, { status: 201 });
}
