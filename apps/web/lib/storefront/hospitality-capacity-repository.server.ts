import { newId } from "@/lib/shared/new-id";
import { loadStorefrontOperatingTimezone } from "./storefront-operating-timezone.server";

import {
  evaluatePoolCapacity,
  HospitalityCapacityConflictError,
  HospitalityCapacityVersionError,
  isHospitalityResourceAvailableForInterval,
  validateAllocationRequest,
  type HospitalityAllocationFact,
  type HospitalityAllocationLifecycle,
  type HospitalityAvailabilityWindow,
  type HospitalityDemandType,
} from "./hospitality-capacity";

interface HospitalityCapacityDatabase {
  businessProfile: {
    findFirst(args: unknown): Promise<{ timezone: string } | null>;
  };
  hospitalityResource: {
    findFirst(args: unknown): Promise<{
      id: string;
      legacyServiceProviderId: string | null;
      status: string;
      capacity?: number;
      availability?: HospitalityAvailabilityWindow[];
    } | null>;
  };
  hospitalityCapacityPool: {
    findFirst(args: unknown): Promise<{
      id: string;
      capacity: number;
      status: string;
    } | null>;
  };
  hospitalityCapacityAllocation: {
    findFirst(args: unknown): Promise<unknown | null>;
    findMany(args: unknown): Promise<HospitalityAllocationFact[]>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
}

export async function resolveHospitalityResourceForProvider(
  database: Pick<HospitalityCapacityDatabase, "hospitalityResource">,
  input: {
    organizationId: string;
    storefrontId: string;
    providerId: string;
  },
) {
  return database.hospitalityResource.findFirst({
    where: {
      organizationId: input.organizationId,
      storefrontId: input.storefrontId,
      legacyServiceProviderId: input.providerId,
      status: "active",
    },
    select: { id: true, legacyServiceProviderId: true, status: true },
  });
}

export async function allocateHospitalityCapacity(
  database: HospitalityCapacityDatabase,
  input: {
    organizationId: string;
    storefrontId: string;
    resourceId: string | null;
    poolId: string | null;
    demandType: HospitalityDemandType;
    demandRef: string;
    bookingId: string | null;
    bookingHoldId: string | null;
    serviceTurnId?: string | null;
    startsAt: Date;
    endsAt: Date;
    quantity: number;
    idempotencyKey: string;
    /**
     * Public holds and bookings must fit the resource's bookable schedule.
     * Authenticated host operations may extend an in-progress service turn
     * beyond the last public bookable start while retaining every occupancy,
     * capacity, version, and idempotency guard.
     */
    enforceResourceAvailability?: boolean;
  },
) {
  validateAllocationRequest(input);

  const existing =
    await database.hospitalityCapacityAllocation.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
    });
  if (existing) return existing;

  if (input.resourceId) {
    // An expired BookingHold no longer reserves customer intent, so its
    // append-preserving allocation must leave the live lifecycle before the
    // exclusion constraint evaluates a new request for this resource.
    const releasedAt = new Date();
    await database.hospitalityCapacityAllocation.updateMany({
      where: {
        organizationId: input.organizationId,
        resourceId: input.resourceId,
        demandType: "hold",
        lifecycle: { in: ["reserved", "active"] },
        bookingHold: { expiresAt: { lte: releasedAt } },
      },
      data: {
        lifecycle: "released",
        releasedAt,
        releaseReason: "Hold expired",
        version: { increment: 1 },
      },
    });

    const resource = await database.hospitalityResource.findFirst({
      where: {
        id: input.resourceId,
        organizationId: input.organizationId,
        storefrontId: input.storefrontId,
        status: "active",
      },
      select: {
        id: true,
        legacyServiceProviderId: true,
        status: true,
        capacity: true,
        availability: {
          select: {
            kind: true,
            days: true,
            startTime: true,
            endTime: true,
            date: true,
          },
        },
      },
    });
    if (!resource) {
      throw new Error("Hospitality resource is unavailable");
    }
    const resourceCapacity = resource.capacity ?? 1;
    if (input.quantity > resourceCapacity) {
      throw new HospitalityCapacityConflictError(
        `Hospitality resource capacity conflict: ${input.quantity} requested, ${resourceCapacity} available`,
        {
          capacity: resourceCapacity,
          used: 0,
          available: resourceCapacity,
          requested: input.quantity,
        },
      );
    }
    if (
      input.enforceResourceAvailability !== false &&
      !isHospitalityResourceAvailableForInterval({
        availability: resource.availability ?? [],
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timeZone: await loadStorefrontOperatingTimezone(database),
      })
    ) {
      throw new HospitalityCapacityConflictError(
        "Hospitality resource is outside its available schedule",
        {
          capacity: 1,
          used: 1,
          available: 0,
          requested: input.quantity,
        },
      );
    }
  } else {
    // The caller runs this repository inside one database transaction. Locking
    // the pool row serializes the read-sum-create boundary across every writer.
    await database.$queryRaw`
      SELECT id
      FROM "HospitalityCapacityPool"
      WHERE id = ${input.poolId}
        AND "organizationId" = ${input.organizationId}
        AND "storefrontId" = ${input.storefrontId}
      FOR UPDATE
    `;
    const pool = await database.hospitalityCapacityPool.findFirst({
      where: {
        id: input.poolId,
        organizationId: input.organizationId,
        storefrontId: input.storefrontId,
        status: "active",
      },
      select: { id: true, capacity: true, status: true },
    });
    if (!pool) throw new Error("Hospitality capacity pool is unavailable");

    const allocations =
      await database.hospitalityCapacityAllocation.findMany({
        where: {
          poolId: pool.id,
          organizationId: input.organizationId,
          lifecycle: { in: ["reserved", "active"] },
          conflictQuarantinedAt: null,
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
        },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          quantity: true,
          lifecycle: true,
          version: true,
        },
      });
    evaluatePoolCapacity({
      capacity: pool.capacity,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      requestedQuantity: input.quantity,
      allocations,
      throwOnConflict: true,
    });
  }

  return database.hospitalityCapacityAllocation.create({
    data: {
      allocationId: `HA-${newId(12).toUpperCase()}`,
      organizationId: input.organizationId,
      storefrontId: input.storefrontId,
      resourceId: input.resourceId,
      poolId: input.poolId,
      bookingId: input.bookingId,
      bookingHoldId: input.bookingHoldId,
      serviceTurnId: input.serviceTurnId ?? null,
      demandType: input.demandType,
      demandRef: input.demandRef,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      quantity: input.quantity,
      lifecycle: "reserved",
      idempotencyKey: input.idempotencyKey,
    },
  });
}

export async function releaseHospitalityCapacity(
  database: Pick<
    HospitalityCapacityDatabase,
    "hospitalityCapacityAllocation"
  >,
  input: {
    allocationId: string;
    organizationId: string;
    expectedVersion: number;
    at: Date;
    reason: string;
    clearBookingHoldLink?: boolean;
  },
): Promise<void> {
  await transitionHospitalityCapacity(database, {
    allocationId: input.allocationId,
    organizationId: input.organizationId,
    expectedVersion: input.expectedVersion,
    lifecycle: "released",
    at: input.at,
    reason: input.reason,
    clearBookingHoldLink: input.clearBookingHoldLink,
  });
}

export async function transitionHospitalityCapacity(
  database: Pick<
    HospitalityCapacityDatabase,
    "hospitalityCapacityAllocation"
  >,
  input: {
    allocationId: string;
    organizationId: string;
    expectedVersion: number;
    lifecycle: Extract<
      HospitalityAllocationLifecycle,
      "active" | "released" | "cancelled" | "quarantined"
    >;
    at: Date;
    reason?: string;
    clearBookingHoldLink?: boolean;
  },
): Promise<void> {
  const terminal = input.lifecycle !== "active";
  const result = await database.hospitalityCapacityAllocation.updateMany({
    where: {
      id: input.allocationId,
      organizationId: input.organizationId,
      version: input.expectedVersion,
      lifecycle:
        input.lifecycle === "active"
          ? "reserved"
          : { in: ["reserved", "active"] },
    },
    data: {
      lifecycle: input.lifecycle,
      releasedAt: terminal ? input.at : null,
      releaseReason: terminal ? (input.reason ?? null) : null,
      version: { increment: 1 },
      ...(input.clearBookingHoldLink ? { bookingHoldId: null } : {}),
    },
  });
  if (result.count !== 1) {
    throw new HospitalityCapacityVersionError(input.expectedVersion, -1);
  }
}

export async function releaseHospitalityCapacityByDemand(
  database: Pick<
    HospitalityCapacityDatabase,
    "hospitalityCapacityAllocation"
  >,
  input: {
    organizationId: string;
    demandType: HospitalityDemandType;
    demandRef: string;
    at: Date;
    reason: string;
    clearBookingHoldLink?: boolean;
  },
): Promise<number> {
  const result = await database.hospitalityCapacityAllocation.updateMany({
    where: {
      organizationId: input.organizationId,
      demandType: input.demandType,
      demandRef: input.demandRef,
      lifecycle: { in: ["reserved", "active"] },
    },
    data: {
      lifecycle: "released",
      releasedAt: input.at,
      releaseReason: input.reason,
      version: { increment: 1 },
      ...(input.clearBookingHoldLink ? { bookingHoldId: null } : {}),
    },
  });
  return result.count;
}
