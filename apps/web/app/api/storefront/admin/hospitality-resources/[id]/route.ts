import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { readActivationProfile } from "@dpf/storefront-templates";

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { newId } from "@/lib/shared/new-id";
import {
  isAdminResourceCapacityValid,
  resolveAdminResourceProfile,
} from "@/lib/resource-scheduling/admin-resource-profile";
import { upsertCanonicalResourceDraft } from "@/lib/resource-scheduling/admin-resource-repository";
import {
  fromHospitalityAvailability,
  fromHospitalityResource,
  type CloneResourceRow,
} from "@/lib/resource-scheduling/clone-adapters";
import {
  parseRestaurantTableAttributes,
  serializeRestaurantTableAttributes,
  validateRestaurantTableAttributesInput,
} from "@/lib/storefront/restaurant-table-attributes";

const STATUSES = new Set(["active", "blocked", "retired"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function canonicalResourceData(
  row: CloneResourceRow & { legacyServiceProviderId?: string | null },
) {
  const { draft } = fromHospitalityResource(row);
  return {
    draft,
    data: {
      ...draft,
      attributes: draft.attributes as Prisma.InputJsonValue,
    },
  };
}

type AvailabilityInput = {
  days: number[];
  startTime: string;
  endTime: string;
};

type ExceptionInput = {
  date: string;
  isBlocked: boolean;
  startTime?: string;
  endTime?: string;
  reason?: string;
};

function validAvailability(row: AvailabilityInput): boolean {
  return (
    Array.isArray(row.days) &&
    row.days.length > 0 &&
    row.days.every(
      (day) => Number.isInteger(day) && day >= 0 && day <= 6,
    ) &&
    new Set(row.days).size === row.days.length &&
    TIME.test(row.startTime) &&
    TIME.test(row.endTime) &&
    row.startTime < row.endTime
  );
}

function validException(row: ExceptionInput): boolean {
  const parsedDate = new Date(`${row.date}T00:00:00.000Z`);
  const startTime = row.startTime ?? "00:00";
  const endTime = row.endTime ?? "23:59";
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    Number.isFinite(parsedDate.getTime()) &&
    typeof row.isBlocked === "boolean" &&
    TIME.test(startTime) &&
    TIME.test(endTime) &&
    startTime < endTime
  );
}

function availabilityDto(
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }
  const { id } = await params;
  const body = (await request.json()) as {
    label?: string;
    capacity?: number;
    serviceArea?: string | null;
    status?: string;
    blockedReason?: string | null;
    expectedVersion?: number;
    availability?: AvailabilityInput[];
    exceptions?: ExceptionInput[];
    shape?: string;
    combinationGroup?: string | null;
    combinableWith?: unknown[];
    bookingAccess?: string;
  };
  const scheduleRequested =
    body.availability !== undefined || body.exceptions !== undefined;

  if (
    scheduleRequested &&
    (!Array.isArray(body.availability) ||
      !Array.isArray(body.exceptions) ||
      body.availability.length > 50 ||
      body.exceptions.length > 50 ||
      !body.availability.every(validAvailability) ||
      !body.exceptions.every(validException))
  ) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      "Valid weekly availability and dated exceptions are required",
      400,
    );
  }

  const current = await prisma.hospitalityResource.findFirst({
    where: { id, kind: "table" },
    select: {
      id: true,
      organizationId: true,
      legacyServiceProviderId: true,
      resourceId: true,
      storefrontId: true,
      kind: true,
      label: true,
      status: true,
      capacity: true,
      capacityUnit: true,
      serviceArea: true,
      blockedReason: true,
      version: true,
      attributes: true,
      storefront: {
        select: {
          timezone: true,
          archetype: { select: { activationProfile: true } },
        },
      },
    },
  });
  if (!current) {
    return apiErrorResponse("NOT_FOUND", "Table not found", 404);
  }

  if (scheduleRequested) {
    const availability = body.availability!;
    const exceptions = body.exceptions!;
    const updated = await prisma.$transaction(async (transaction) => {
      const canonical = canonicalResourceData(current);
      const canonicalResource = await upsertCanonicalResourceDraft(
        transaction.resource,
        canonical.data,
      );
      await transaction.hospitalityResourceAvailability.deleteMany({
        where: {
          resourceId: current.id,
          organizationId: current.organizationId,
        },
      });
      const hospitalityRows = [
        ...availability.map((row) => ({
          id: newId(),
          availabilityId: `HRA-${newId(10).toUpperCase()}`,
          organizationId: current.organizationId,
          resourceId: current.id,
          kind: "available",
          days: row.days,
          startTime: row.startTime,
          endTime: row.endTime,
          date: null,
          reason: null,
        })),
        ...exceptions.map((row) => ({
          id: newId(),
          availabilityId: `HRA-${newId(10).toUpperCase()}`,
          organizationId: current.organizationId,
          resourceId: current.id,
          kind: row.isBlocked ? "blocked" : "available",
          days: [],
          startTime: row.startTime ?? "00:00",
          endTime: row.endTime ?? "23:59",
          date: new Date(`${row.date}T00:00:00.000Z`),
          reason: row.reason?.trim() || null,
        })),
      ];
      if (hospitalityRows.length > 0) {
        await transaction.hospitalityResourceAvailability.createMany({
          data: hospitalityRows,
        });
      }

      await transaction.resourceAvailability.deleteMany({
        where: {
          resourceId: canonicalResource.id,
          organizationId: current.organizationId,
        },
      });
      if (hospitalityRows.length > 0) {
        const canonicalRows = hospitalityRows.map((row) =>
          fromHospitalityAvailability(
            {
              id: row.id,
              organizationId: row.organizationId,
              kind: row.kind,
              days: row.days,
              startTime: row.startTime,
              endTime: row.endTime,
              date: row.date,
              startsAt: null,
              endsAt: null,
              reason: row.reason,
              version: 1,
            },
            {
              unifiedResourceId: canonicalResource.id,
              timezone: current.storefront.timezone,
            },
          ).draft,
        );
        await transaction.resourceAvailability.createMany({
          data: canonicalRows,
        });
      }

      // Keep the phase-one slot-engine projection synchronized until the
      // compatibility provider bridge can be contracted fleet-wide.
      if (current.legacyServiceProviderId) {
        await transaction.providerAvailability.deleteMany({
          where: { providerId: current.legacyServiceProviderId },
        });
        const providerRows = [
          ...availability.map((row) => ({
            providerId: current.legacyServiceProviderId!,
            days: row.days,
            startTime: row.startTime,
            endTime: row.endTime,
            isBlocked: false,
          })),
          ...exceptions.map((row) => ({
            providerId: current.legacyServiceProviderId!,
            days: [],
            startTime: row.startTime ?? "00:00",
            endTime: row.endTime ?? "23:59",
            date: new Date(`${row.date}T00:00:00.000Z`),
            isBlocked: row.isBlocked,
            reason: row.reason?.trim() || null,
          })),
        ];
        if (providerRows.length > 0) {
          await transaction.providerAvailability.createMany({
            data: providerRows,
          });
        }
      }

      return transaction.hospitalityResource.findUnique({
        where: { id },
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
    });
    if (!updated) {
      return apiErrorResponse("NOT_FOUND", "Table not found", 404);
    }
    return NextResponse.json({
      resource: {
        ...updated,
        availability: availabilityDto(updated.availability),
      },
    });
  }

  const label = body.label?.trim();
  const activationProfile = readActivationProfile(
    current.storefront.archetype.activationProfile,
  );
  const adminProfile = resolveAdminResourceProfile(
    activationProfile?.processProfile,
    current.kind,
  );
  if (!adminProfile) {
    return apiErrorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
  const currentAttributes = parseRestaurantTableAttributes(current.attributes);
  const attributes = validateRestaurantTableAttributesInput({
    shape: body.shape ?? currentAttributes.shape,
    combinationGroup:
      body.combinationGroup === undefined
        ? currentAttributes.combinationGroup
        : body.combinationGroup,
    combinableWith:
      body.combinableWith === undefined
        ? currentAttributes.combinableWith
        : body.combinableWith,
    bookingAccess: body.bookingAccess ?? currentAttributes.bookingAccess,
  });
  if (
    !label ||
    !isAdminResourceCapacityValid(body.capacity, adminProfile) ||
    !body.status ||
    !STATUSES.has(body.status) ||
    !Number.isInteger(body.expectedVersion) ||
    !attributes.ok
  ) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      attributes.ok
        ? "Valid label, seats, status, and expectedVersion are required"
        : attributes.error,
      400,
    );
  }

  try {
    const resource = await prisma.$transaction(async (transaction) => {
      const changed = await transaction.hospitalityResource.updateMany({
        where: {
          id,
          organizationId: current.organizationId,
          version: body.expectedVersion,
        },
        data: {
          label,
          capacity: body.capacity,
          serviceArea: body.serviceArea?.trim() || null,
          status: body.status,
          blockedReason:
            body.status === "blocked"
              ? body.blockedReason?.trim() || null
              : null,
          attributes: serializeRestaurantTableAttributes(
            attributes.value,
          ) as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new Error("RESOURCE_VERSION_CONFLICT");

      if (current.legacyServiceProviderId) {
        await transaction.serviceProvider.update({
          where: { id: current.legacyServiceProviderId },
          data: {
            name: label,
            isActive: body.status === "active",
          },
        });
      }
      const updated = await transaction.hospitalityResource.findUnique({
        where: { id },
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
      if (updated) {
        const canonical = canonicalResourceData(updated);
        await upsertCanonicalResourceDraft(transaction.resource, canonical.data);
      }
      return updated;
    });
    return NextResponse.json({
      resource: resource
        ? {
            ...resource,
            availability: availabilityDto(resource.availability),
          }
        : null,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "RESOURCE_VERSION_CONFLICT"
    ) {
      return apiErrorResponse(
        "VERSION_CONFLICT",
        "This table changed while you were editing it. Reload and review the latest values.",
        409,
      );
    }
    throw error;
  }
}
