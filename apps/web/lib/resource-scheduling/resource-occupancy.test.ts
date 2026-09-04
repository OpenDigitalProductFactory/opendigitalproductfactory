import { describe, expect, it, vi } from "vitest";

import {
  OccupancyCommandError,
  placeResourceOccupant,
  releaseResourceOccupant,
  type OccupancyClient,
} from "./resource-occupancy";

function fixture() {
  const tx = {
    $executeRawUnsafe: vi.fn(async () => 0),
    adoptableAnimal: { findFirst: vi.fn() },
    resource: { findFirst: vi.fn() },
    resourceCapacityAllocation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  };
  const db = {
    $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
  };
  tx.adoptableAnimal.findFirst.mockResolvedValue({ animalRef: "animal-1", status: "hold" });
  tx.resource.findFirst.mockResolvedValue({
    id: "foster-1",
    organizationId: "org-1",
    domain: "care",
    kindSlug: "foster-home",
    capacityUnit: "animals",
    capacity: 2,
    blockedReason: null,
    lifecycle: "active",
  });
  tx.resourceCapacityAllocation.findFirst.mockResolvedValue(null);
  tx.resourceCapacityAllocation.findMany.mockResolvedValue([]);
  tx.resourceCapacityAllocation.updateMany.mockResolvedValue({ count: 1 });
  tx.resourceCapacityAllocation.create.mockResolvedValue({
    id: "allocation-new",
    demandRef: "animal-1",
    resourceId: "foster-1",
    startsAt: new Date("2026-09-04T12:00:00Z"),
    releasedAt: null,
    releaseReason: null,
  });
  return { db, tx };
}

describe("resource occupancy commands", () => {
  it("locks subject and destination, closes the prior stay, and creates one placement", async () => {
    const { db, tx } = fixture();
    tx.resourceCapacityAllocation.findMany
      .mockResolvedValueOnce([
        {
          id: "allocation-old",
          demandRef: "animal-1",
          resourceId: "kennel-1",
          quantity: 1,
          releasedAt: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await placeResourceOccupant({
      db: db as unknown as OccupancyClient,
      organizationId: "org-1",
      allowedKinds: ["kennel", "foster-home"],
      command: {
        animalRef: "animal-1",
        destinationResourceId: "foster-1",
        placedAt: new Date("2026-09-04T12:00:00Z"),
        idempotencyKey: "move:animal-1:foster-1",
      },
    });

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(tx.resourceCapacityAllocation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["allocation-old"] }, organizationId: "org-1", releasedAt: null },
      data: expect.objectContaining({ releaseReason: "moved" }),
    });
    expect(tx.resourceCapacityAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        demandSlug: "animal-occupancy",
        demandRef: "animal-1",
        resourceId: "foster-1",
        idempotencyKey: "move:animal-1:foster-1",
      }),
      select: expect.any(Object),
    });
    expect(result.capacity).toEqual({ occupied: 1, total: 2, available: 1 });
  });

  it("fails explicitly when a compatible destination is full", async () => {
    const { db, tx } = fixture();
    tx.resourceCapacityAllocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "a", demandRef: "other-1", quantity: 1, releasedAt: null },
        { id: "b", demandRef: "other-2", quantity: 1, releasedAt: null },
      ]);

    await expect(
      placeResourceOccupant({
        db: db as unknown as OccupancyClient,
        organizationId: "org-1",
        allowedKinds: ["kennel", "foster-home"],
        command: {
          animalRef: "animal-1",
          destinationResourceId: "foster-1",
          placedAt: new Date("2026-09-04T12:00:00Z"),
          idempotencyKey: "full",
        },
      }),
    ).rejects.toBeInstanceOf(OccupancyCommandError);
    expect(tx.resourceCapacityAllocation.create).not.toHaveBeenCalled();
  });

  it("returns an idempotent placement without writing twice", async () => {
    const { db, tx } = fixture();
    tx.resourceCapacityAllocation.findFirst.mockResolvedValue({
      id: "existing",
      demandRef: "animal-1",
      resourceId: "foster-1",
      startsAt: new Date("2026-09-04T12:00:00Z"),
      releasedAt: null,
      releaseReason: null,
    });
    tx.resourceCapacityAllocation.findMany.mockResolvedValue([{ quantity: 1, demandRef: "animal-1" }]);

    const result = await placeResourceOccupant({
      db: db as unknown as OccupancyClient,
      organizationId: "org-1",
      allowedKinds: ["foster-home"],
      command: {
        animalRef: "animal-1",
        destinationResourceId: "foster-1",
        placedAt: new Date("2026-09-04T12:00:00Z"),
        idempotencyKey: "same",
      },
    });

    expect(result.allocationId).toBe("existing");
    expect(tx.resourceCapacityAllocation.create).not.toHaveBeenCalled();
  });

  it("rejects a retry key already bound to a different placement", async () => {
    const { db, tx } = fixture();
    tx.resourceCapacityAllocation.findFirst.mockResolvedValue({
      id: "existing",
      demandRef: "animal-other",
      resourceId: "kennel-other",
      startsAt: new Date("2026-09-04T12:00:00Z"),
      releasedAt: null,
      releaseReason: null,
    });
    tx.resourceCapacityAllocation.findMany.mockResolvedValue([]);

    await expect(
      placeResourceOccupant({
        db: db as unknown as OccupancyClient,
        organizationId: "org-1",
        allowedKinds: ["foster-home"],
        command: {
          animalRef: "animal-1",
          destinationResourceId: "foster-1",
          placedAt: new Date("2026-09-04T12:00:00Z"),
          idempotencyKey: "reused",
        },
      }),
    ).rejects.toMatchObject({ code: "placement_conflict" });
    expect(tx.resourceCapacityAllocation.create).not.toHaveBeenCalled();
  });

  it("releases an active stay without deleting history", async () => {
    const { db, tx } = fixture();
    tx.resourceCapacityAllocation.findFirst.mockResolvedValue({
      id: "allocation-1",
      organizationId: "org-1",
      demandRef: "animal-1",
      resourceId: "foster-1",
      startsAt: new Date("2026-09-04T12:00:00Z"),
      releasedAt: null,
      releaseReason: null,
    });

    await releaseResourceOccupant({
      db: db as unknown as OccupancyClient,
      organizationId: "org-1",
      command: {
        allocationId: "allocation-1",
        expectedResourceId: "foster-1",
        releasedAt: new Date("2026-09-05T12:00:00Z"),
        reason: "left-care",
        idempotencyKey: "release-1",
      },
    });

    expect(tx.resourceCapacityAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "allocation-1",
        organizationId: "org-1",
        resourceId: "foster-1",
        releasedAt: null,
      },
      data: expect.objectContaining({ releaseReason: "left-care" }),
    });
    expect((tx.resourceCapacityAllocation as Record<string, unknown>).delete).toBeUndefined();
  });
});
