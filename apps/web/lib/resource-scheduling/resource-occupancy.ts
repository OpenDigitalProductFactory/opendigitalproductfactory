import { openStayHorizon } from "@/lib/ward/ward-store";

const OCCUPANCY_SLUG = "animal-occupancy";
const MAX_SERIALIZATION_ATTEMPTS = 3;

interface AllocationRow {
  id: string;
  demandRef: string;
  resourceId: string | null;
  startsAt: Date;
  releasedAt: Date | null;
  releaseReason: string | null;
  quantity?: number;
}

interface OccupancyTransaction {
  $executeRawUnsafe(query: string, value: string): Promise<unknown>;
  adoptableAnimal: { findFirst(args: unknown): Promise<{ animalRef: string; status: string } | null> };
  resource: {
    findFirst(args: unknown): Promise<{
      id: string;
      organizationId: string;
      domain: string;
      kindSlug: string;
      capacityUnit: string;
      capacity: number;
      blockedReason: string | null;
      lifecycle: string;
    } | null>;
  };
  resourceCapacityAllocation: {
    findFirst(args: unknown): Promise<AllocationRow | null>;
    findMany(args: unknown): Promise<AllocationRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<AllocationRow>;
  };
}

export interface OccupancyClient {
  $transaction<T>(
    work: (transaction: OccupancyTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export class OccupancyCommandError extends Error {
  constructor(
    public readonly code:
      | "animal_not_found"
      | "resource_not_found"
      | "resource_incompatible"
      | "resource_blocked"
      | "resource_full"
      | "placement_not_found"
      | "placement_conflict",
    message: string,
  ) {
    super(message);
    this.name = "OccupancyCommandError";
  }
}

export interface OccupancyResult {
  allocationId: string;
  animalRef: string;
  resourceId: string;
  placedAt: Date;
  releasedAt: Date | null;
  releaseReason: string | null;
  capacity: { occupied: number; total: number; available: number };
}

async function lock(transaction: OccupancyTransaction, key: string): Promise<void> {
  await transaction.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    key,
  );
}

function isSerializationConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2034";
}

async function serializable<T>(db: OccupancyClient, work: (tx: OccupancyTransaction) => Promise<T>) {
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === MAX_SERIALIZATION_ATTEMPTS) throw error;
    }
  }
  throw new Error("unreachable");
}

function result(row: AllocationRow, occupied: number, total: number): OccupancyResult {
  return {
    allocationId: row.id,
    animalRef: row.demandRef,
    resourceId: row.resourceId!,
    placedAt: row.startsAt,
    releasedAt: row.releasedAt,
    releaseReason: row.releaseReason,
    capacity: { occupied, total, available: Math.max(total - occupied, 0) },
  };
}

export async function placeResourceOccupant(input: {
  db: OccupancyClient;
  organizationId: string;
  allowedKinds: readonly string[];
  command: {
    animalRef: string;
    destinationResourceId: string;
    placedAt: Date;
    idempotencyKey: string;
  };
}): Promise<OccupancyResult> {
  return serializable(input.db, async (transaction) => {
    for (const key of [
      `animal:${input.organizationId}:${input.command.animalRef}`,
      `resource:${input.organizationId}:${input.command.destinationResourceId}`,
    ].sort()) {
      await lock(transaction, key);
    }

    const [animal, destination, replay] = await Promise.all([
      transaction.adoptableAnimal.findFirst({
        where: {
          organizationId: input.organizationId,
          animalRef: input.command.animalRef,
          status: { not: "adopted" },
        },
        select: { animalRef: true, status: true },
      }),
      transaction.resource.findFirst({
        where: {
          id: input.command.destinationResourceId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          organizationId: true,
          domain: true,
          kindSlug: true,
          capacityUnit: true,
          capacity: true,
          blockedReason: true,
          lifecycle: true,
        },
      }),
      transaction.resourceCapacityAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          idempotencyKey: input.command.idempotencyKey,
        },
        select: {
          id: true,
          demandRef: true,
          resourceId: true,
          startsAt: true,
          releasedAt: true,
          releaseReason: true,
        },
      }),
    ]);
    if (!animal) throw new OccupancyCommandError("animal_not_found", "Animal not found in current care.");
    if (!destination) throw new OccupancyCommandError("resource_not_found", "Housing destination not found.");
    if (
      destination.domain !== "care" ||
      destination.capacityUnit !== "animals" ||
      !input.allowedKinds.includes(destination.kindSlug) ||
      destination.lifecycle !== "active"
    ) {
      throw new OccupancyCommandError(
        "resource_incompatible",
        "Choose an active housing destination configured for animals.",
      );
    }
    if (destination.blockedReason) {
      throw new OccupancyCommandError("resource_blocked", "That housing destination is out of service.");
    }
    if (
      replay &&
      (replay.demandRef !== input.command.animalRef ||
        replay.resourceId !== input.command.destinationResourceId)
    ) {
      throw new OccupancyCommandError(
        "placement_conflict",
        "That retry key is already bound to a different placement.",
      );
    }

    const [subjectRows, destinationRows] = await Promise.all([
      transaction.resourceCapacityAllocation.findMany({
        where: {
          organizationId: input.organizationId,
          demandSlug: OCCUPANCY_SLUG,
          demandRef: input.command.animalRef,
          releasedAt: null,
        },
        select: { id: true, demandRef: true, resourceId: true, quantity: true, releasedAt: true },
      }),
      transaction.resourceCapacityAllocation.findMany({
        where: {
          organizationId: input.organizationId,
          demandSlug: OCCUPANCY_SLUG,
          resourceId: destination.id,
          releasedAt: null,
        },
        select: { id: true, demandRef: true, resourceId: true, quantity: true, releasedAt: true },
      }),
    ]);
    const otherOccupied = destinationRows
      .filter((row) => row.demandRef !== input.command.animalRef)
      .reduce((sum, row) => sum + (row.quantity ?? 1), 0);
    if (otherOccupied + 1 > destination.capacity) {
      throw new OccupancyCommandError("resource_full", "That housing destination is full.");
    }
    if (replay) return result(replay, otherOccupied + 1, destination.capacity);

    if (subjectRows.length > 0) {
      await transaction.resourceCapacityAllocation.updateMany({
        where: {
          id: { in: subjectRows.map((row) => row.id) },
          organizationId: input.organizationId,
          releasedAt: null,
        },
        data: { releasedAt: input.command.placedAt, releaseReason: "moved" },
      });
    }
    const created = await transaction.resourceCapacityAllocation.create({
      data: {
        organizationId: input.organizationId,
        domain: "care",
        resourceId: destination.id,
        demandSlug: OCCUPANCY_SLUG,
        demandRef: input.command.animalRef,
        startsAt: input.command.placedAt,
        endsAt: openStayHorizon(input.command.placedAt),
        quantity: 1,
        state: "active",
        idempotencyKey: input.command.idempotencyKey,
      },
      select: {
        id: true,
        demandRef: true,
        resourceId: true,
        startsAt: true,
        releasedAt: true,
        releaseReason: true,
      },
    });
    return result(created, otherOccupied + 1, destination.capacity);
  });
}

export async function releaseResourceOccupant(input: {
  db: OccupancyClient;
  organizationId: string;
  command: {
    allocationId: string;
    expectedResourceId: string;
    releasedAt: Date;
    reason: string;
    idempotencyKey: string;
  };
}): Promise<AllocationRow> {
  return serializable(input.db, async (transaction) => {
    const allocation = await transaction.resourceCapacityAllocation.findFirst({
      where: { id: input.command.allocationId, organizationId: input.organizationId },
      select: {
        id: true,
        organizationId: true,
        demandRef: true,
        resourceId: true,
        startsAt: true,
        releasedAt: true,
        releaseReason: true,
      },
    });
    if (!allocation || allocation.resourceId !== input.command.expectedResourceId) {
      throw new OccupancyCommandError("placement_not_found", "Current placement not found.");
    }
    await lock(transaction, `animal:${input.organizationId}:${allocation.demandRef}`);
    if (allocation.releasedAt) return allocation;
    const changed = await transaction.resourceCapacityAllocation.updateMany({
      where: {
        id: input.command.allocationId,
        organizationId: input.organizationId,
        resourceId: input.command.expectedResourceId,
        releasedAt: null,
      },
      data: {
        releasedAt: input.command.releasedAt,
        releaseReason: input.command.reason.trim() || "left-care",
      },
    });
    if (changed.count !== 1) {
      throw new OccupancyCommandError(
        "placement_conflict",
        "This placement changed. Reload and review the current housing record.",
      );
    }
    return { ...allocation, releasedAt: input.command.releasedAt, releaseReason: input.command.reason };
  });
}
