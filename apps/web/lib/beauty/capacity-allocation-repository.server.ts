import { newId } from "@/lib/shared/new-id";
import { beautyResourceIsAvailable, type BeautyAvailabilityRow } from "./availability";

interface BeautyAllocationDatabase {
  beautyResource: {
    findFirst(args: unknown): Promise<{
      id: string;
      status: string;
      availability: BeautyAvailabilityRow[];
      storefront: { timezone: string };
    } | null>;
  };
  beautyCapacityAllocation: {
    findFirst(args: unknown): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export class BeautyCapacityConflictError extends Error {
  readonly code = "BEAUTY_CAPACITY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "BeautyCapacityConflictError";
  }
}

export class BeautyCapacityVersionError extends Error {
  readonly code = "BEAUTY_CAPACITY_VERSION_CONFLICT";

  constructor(readonly expectedVersion: number) {
    super(`Beauty allocation version conflict at expected version ${expectedVersion}`);
    this.name = "BeautyCapacityVersionError";
  }
}

function validate(input: {
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  bookingId: string | null;
  bookingHoldId: string | null;
}) {
  if (!Number.isFinite(input.startsAt.getTime()) || !Number.isFinite(input.endsAt.getTime())) {
    throw new TypeError("Beauty allocation start and end must be valid dates");
  }
  if (input.endsAt <= input.startsAt) throw new RangeError("Beauty allocation end must be after start");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError("Beauty allocation quantity must be a positive integer");
  }
  if (Boolean(input.bookingId) === Boolean(input.bookingHoldId)) {
    throw new TypeError("Beauty allocation must target exactly one booking or hold");
  }
}

function isExclusionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; meta?: { database_error?: unknown } };
  return value.code === "P2004" ||
    String(value.message ?? "").includes("BeautyCapacityAllocation_no_resource_overlap") ||
    String(value.meta?.database_error ?? "").includes("BeautyCapacityAllocation_no_resource_overlap");
}

export async function allocateBeautyCapacity(
  database: BeautyAllocationDatabase,
  input: {
    organizationId: string;
    storefrontId: string;
    resourceId: string;
    itemId: string;
    demandRef: string;
    bookingId: string | null;
    bookingHoldId: string | null;
    startsAt: Date;
    endsAt: Date;
    quantity: number;
    idempotencyKey: string;
  },
) {
  validate(input);
  const existing = await database.beautyCapacityAllocation.findFirst({
    where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const releasedAt = new Date();
  await database.beautyCapacityAllocation.updateMany({
    where: {
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      lifecycle: "held",
      bookingHold: { expiresAt: { lte: releasedAt } },
    },
    data: {
      lifecycle: "released",
      releasedAt,
      releaseReason: "Hold expired",
      bookingHoldId: null,
      version: { increment: 1 },
    },
  });

  const resource = await database.beautyResource.findFirst({
    where: {
      id: input.resourceId,
      organizationId: input.organizationId,
      storefrontId: input.storefrontId,
      status: "active",
      services: { some: { itemId: input.itemId } },
    },
    select: {
      id: true,
      status: true,
      availability: {
        select: {
          availabilityId: true,
          resourceId: true,
          kind: true,
          days: true,
          startTime: true,
          endTime: true,
          date: true,
          startsAt: true,
          endsAt: true,
          reason: true,
        },
      },
      storefront: { select: { timezone: true } },
    },
  });
  if (!resource) {
    throw new BeautyCapacityConflictError("The chair, station, or room is unavailable for this service");
  }
  if (!beautyResourceIsAvailable({
    rows: resource.availability,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timeZone: resource.storefront.timezone,
  })) {
    throw new BeautyCapacityConflictError("The chair, station, or room is outside its available schedule");
  }

  try {
    return await database.beautyCapacityAllocation.create({
      data: {
        allocationId: `BA-${newId(12).toUpperCase()}`,
        organizationId: input.organizationId,
        storefrontId: input.storefrontId,
        resourceId: input.resourceId,
        bookingId: input.bookingId,
        bookingHoldId: input.bookingHoldId,
        demandType: input.bookingHoldId ? "hold" : "booking",
        demandRef: input.demandRef,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        quantity: input.quantity,
        lifecycle: input.bookingHoldId ? "held" : "confirmed",
        idempotencyKey: input.idempotencyKey,
      },
    });
  } catch (error) {
    if (isExclusionConflict(error)) {
      throw new BeautyCapacityConflictError("The chair, station, or room is already reserved for that time");
    }
    throw error;
  }
}

export async function releaseBeautyCapacity(
  database: Pick<BeautyAllocationDatabase, "beautyCapacityAllocation">,
  input: {
    allocationId: string;
    organizationId: string;
    expectedVersion: number;
    at: Date;
    reason: string;
    clearBookingHoldLink?: boolean;
  },
): Promise<void> {
  const result = await database.beautyCapacityAllocation.updateMany({
    where: {
      allocationId: input.allocationId,
      organizationId: input.organizationId,
      version: input.expectedVersion,
      lifecycle: { in: ["held", "confirmed", "active"] },
    },
    data: {
      lifecycle: "released",
      releasedAt: input.at,
      releaseReason: input.reason,
      ...(input.clearBookingHoldLink ? { bookingHoldId: null } : {}),
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new BeautyCapacityVersionError(input.expectedVersion);
}

export async function releaseBeautyCapacityByDemand(
  database: Pick<BeautyAllocationDatabase, "beautyCapacityAllocation">,
  input: {
    organizationId: string;
    demandRef: string;
    at: Date;
    reason: string;
    clearBookingHoldLink?: boolean;
  },
): Promise<number> {
  const result = await database.beautyCapacityAllocation.updateMany({
    where: {
      organizationId: input.organizationId,
      demandRef: input.demandRef,
      lifecycle: { in: ["held", "confirmed", "active"] },
    },
    data: {
      lifecycle: "released",
      releasedAt: input.at,
      releaseReason: input.reason,
      ...(input.clearBookingHoldLink ? { bookingHoldId: null } : {}),
      version: { increment: 1 },
    },
  });
  return result.count;
}
