import { describe, expect, it, vi } from "vitest";

import type {
  OperationalAssignmentCommand,
  OperationalCommandAdapterResult,
} from "./operations-command";
import { createRestaurantFloorCommandAdapter } from "./restaurant-floor-command.server";
import { restaurantSeatingVersion } from "../storefront/restaurant-seating";

const startsAt = new Date("2026-07-31T18:00:00.000Z");
const endsAt = new Date("2026-07-31T19:15:00.000Z");
const demand = {
  id: "booking-1",
  bookingRef: "BOOK-1",
  covers: 4,
  status: "waiting",
  scheduledAt: startsAt,
  durationMinutes: 75,
  updatedAt: new Date("2026-07-31T17:55:00.000Z"),
};
const resources = [
  {
    id: "table-1",
    label: "Table 1",
    status: "active",
    capacity: 2,
    version: 1,
    attributes: {
      shape: "square",
      combinationGroup: "main",
      combinableWith: [],
    },
  },
  {
    id: "table-2",
    label: "Table 2",
    status: "active",
    capacity: 2,
    version: 2,
    attributes: {
      shape: "square",
      combinationGroup: "main",
      combinableWith: [],
    },
  },
];

function command(expectedVersion = restaurantSeatingVersion({
  demand,
  resources,
  allocations: [],
})): OperationalAssignmentCommand {
  return {
    kind: "assign",
    idempotencyKey: "seat-booking-1-tables-1-2",
    expectedVersion,
    interval: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
    entityRefs: {
      demandId: demand.id,
      resourceIds: resources.map((resource) => resource.id),
    },
  };
}

function fixture(overrides: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    storefrontBooking: {
      findFirst: vi.fn().mockResolvedValue(demand),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hospitalityResource: {
      findMany: vi.fn().mockResolvedValue(resources),
    },
    hospitalityCapacityAllocation: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hospitalityServiceTurnEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    staffingResourceLink: {
      findMany: vi.fn().mockResolvedValue(
        resources.map((resource) => ({
          resourceRef: resource.id,
          shift: {
            assignments: [
              {
                id: "assignment-1",
                lifecycle: "on_site",
              },
            ],
          },
        })),
      ),
    },
    ...overrides,
  };
  return {
    tx,
    database: {
      $transaction: vi.fn(async (
        run: (
          client: typeof tx,
        ) => Promise<OperationalCommandAdapterResult>,
      ) =>
        run(tx)
      ),
    },
  };
}

describe("restaurant floor command adapter", () => {
  it("seats a combined-table party atomically under one service turn", async () => {
    const { database, tx } = fixture();
    const createTurn = vi.fn().mockResolvedValue({
      id: "turn-1",
      turnId: "HT-1",
      stage: "seated",
      version: 1,
    });
    const allocateCapacity = vi.fn().mockImplementation(
      async (_database, input) => ({
        id: `allocation-${input.resourceId}`,
        version: 1,
      }),
    );
    const transitionCapacity = vi.fn().mockResolvedValue(undefined);
    const adapter = createRestaurantFloorCommandAdapter({
      database,
      organizationId: "org-1",
      storefrontId: "store-1",
      actorRef: "employee-1",
      dependencies: {
        createTurn,
        allocateCapacity,
        transitionCapacity,
      },
    });

    await expect(adapter.executeAtomically(command())).resolves.toEqual({
      status: "confirmed",
      newVersion: "restaurant-turn:HT-1:1",
      changedFacts: [
        { entityId: "booking-1", field: "status", value: "seated" },
        {
          entityId: "booking-1",
          field: "resourceIds",
          value: "table-1,table-2",
        },
        {
          entityId: "booking-1",
          field: "staffingAssignmentId",
          value: "assignment-1",
        },
      ],
    });
    expect(createTurn).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        demandRef: "BOOK-1",
        staffingAssignmentId: "assignment-1",
        idempotencyKey: command().idempotencyKey,
      }),
    );
    expect(allocateCapacity).toHaveBeenCalledTimes(2);
    expect(allocateCapacity).toHaveBeenNthCalledWith(
      1,
      tx,
      expect.objectContaining({
        resourceId: "table-1",
        serviceTurnId: "turn-1",
        enforceResourceAvailability: false,
      }),
    );
    expect(allocateCapacity).toHaveBeenNthCalledWith(
      2,
      tx,
      expect.objectContaining({
        resourceId: "table-2",
        serviceTurnId: "turn-1",
        enforceResourceAvailability: false,
      }),
    );
    expect(transitionCapacity).toHaveBeenCalledTimes(2);
    expect(tx.storefrontBooking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        organizationId: "org-1",
        updatedAt: demand.updatedAt,
        status: "waiting",
      },
      data: {
        hospitalityResourceId: "table-1",
        status: "seated",
      },
    });
  });

  it("fails closed when a refreshed demand still owns a terminal service turn", async () => {
    const { database, tx } = fixture();
    const allocateCapacity = vi.fn();
    const adapter = createRestaurantFloorCommandAdapter({
      database,
      organizationId: "org-1",
      storefrontId: "store-1",
      actorRef: "employee-1",
      dependencies: {
        createTurn: vi.fn().mockResolvedValue({
          id: "turn-closed",
          turnId: "HT-CLOSED",
          stage: "closed",
          version: 6,
        }),
        allocateCapacity,
        transitionCapacity: vi.fn(),
      },
    });

    await expect(adapter.executeAtomically(command())).resolves.toEqual({
      status: "rejected",
      reasonCode: "demand-turn-terminal",
      message: "This party already completed service. Refresh the floor before seating another party.",
    });
    expect(allocateCapacity).not.toHaveBeenCalled();
    expect(tx.storefrontBooking.updateMany).not.toHaveBeenCalled();
  });

  it("returns a version conflict before any write when facts changed", async () => {
    const { database } = fixture();
    const createTurn = vi.fn();
    const allocateCapacity = vi.fn();
    const adapter = createRestaurantFloorCommandAdapter({
      database,
      organizationId: "org-1",
      storefrontId: "store-1",
      actorRef: "employee-1",
      dependencies: {
        createTurn,
        allocateCapacity,
        transitionCapacity: vi.fn(),
      },
    });

    await expect(
      adapter.executeAtomically(command("restaurant-seat.v1-stale")),
    ).resolves.toMatchObject({
      status: "conflict",
      currentVersion: restaurantSeatingVersion({
        demand,
        resources,
        allocations: [],
      }),
      changedFacts: [],
    });
    expect(createTurn).not.toHaveBeenCalled();
    expect(allocateCapacity).not.toHaveBeenCalled();
  });

  it("returns currently valid table alternatives with a stale-version conflict", async () => {
    const alternative = {
      id: "table-3",
      label: "Table 3",
      status: "active",
      capacity: 4,
      version: 1,
      attributes: { shape: "round" },
    };
    const { database } = fixture({
      hospitalityResource: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce(resources)
          .mockResolvedValueOnce([...resources, alternative]),
      },
      hospitalityCapacityAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const adapter = createRestaurantFloorCommandAdapter({
      database,
      organizationId: "org-1",
      storefrontId: "store-1",
      actorRef: "employee-1",
      dependencies: {
        createTurn: vi.fn(),
        allocateCapacity: vi.fn(),
        transitionCapacity: vi.fn(),
      },
    });

    await expect(
      adapter.executeAtomically(command("restaurant-seat.v1-stale")),
    ).resolves.toMatchObject({
      status: "conflict",
      alternatives: [{ resourceIds: ["table-3"], label: "Table 3" }],
    });
  });

  it("reports an overlapping allocation as a conflict without partial writes", async () => {
    const allocations = [
      {
        id: "allocation-existing",
        resourceId: "table-1",
        startsAt,
        endsAt,
        lifecycle: "active" as const,
        version: 1,
        demandRef: "OTHER-BOOKING",
      },
    ];
    const { database } = fixture({
      hospitalityCapacityAllocation: {
        findMany: vi.fn().mockResolvedValue(allocations),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const createTurn = vi.fn();
    const adapter = createRestaurantFloorCommandAdapter({
      database,
      organizationId: "org-1",
      storefrontId: "store-1",
      actorRef: "employee-1",
      dependencies: {
        createTurn,
        allocateCapacity: vi.fn(),
        transitionCapacity: vi.fn(),
      },
    });
    const expectedVersion = restaurantSeatingVersion({
      demand,
      resources,
      allocations,
    });

    await expect(
      adapter.executeAtomically(command(expectedVersion)),
    ).resolves.toMatchObject({
      status: "conflict",
      alternatives: [],
    });
    expect(createTurn).not.toHaveBeenCalled();
  });
});
