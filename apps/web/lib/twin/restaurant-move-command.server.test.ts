import { describe, expect, it, vi } from "vitest";

import {
  executeRestaurantMoveCommand,
  type RestaurantMoveCommand,
} from "./restaurant-move-command.server";
import { restaurantSeatingVersion } from "../storefront/restaurant-seating";

const now = new Date("2026-07-31T18:30:00.000Z");
const endsAt = new Date("2026-07-31T19:15:00.000Z");
const booking = {
  id: "booking-1",
  bookingRef: "BOOK-1",
  covers: 2,
  status: "seated",
  updatedAt: new Date("2026-07-31T18:00:00.000Z"),
};
const target = {
  id: "table-2",
  label: "Table 2",
  status: "active",
  capacity: 2,
  version: 4,
  attributes: { shape: "round" },
};
const command: RestaurantMoveCommand = {
  idempotencyKey: "move-turn-1-table-2-v2",
  serviceTurnId: "turn-1",
  expectedTurnVersion: 2,
  expectedSeatingVersion: restaurantSeatingVersion({
    demand: booking,
    resources: [target],
    allocations: [],
  }),
  interval: {
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
  },
  resourceIds: ["table-2"],
};

function fixture() {
  const currentAllocations = [
    {
      id: "allocation-1",
      resourceId: "table-1",
      version: 3,
      startsAt: new Date("2026-07-31T18:00:00.000Z"),
      endsAt,
      lifecycle: "active" as const,
      demandRef: "BOOK-1",
    },
  ];
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hospitalityServiceTurnEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    hospitalityServiceTurn: {
      findFirst: vi.fn().mockResolvedValue({
        id: "turn-1",
        turnId: "HT-TURN1",
        stage: "ordered",
        version: 2,
        bookingId: "booking-1",
        booking,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hospitalityResource: {
      findMany: vi.fn().mockResolvedValue([target]),
    },
    hospitalityCapacityAllocation: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(currentAllocations)
        .mockResolvedValueOnce([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    staffingResourceLink: {
      findMany: vi.fn().mockResolvedValue([
        {
          resourceRef: "table-2",
          shift: {
            assignments: [{ id: "assignment-2", lifecycle: "on_site" }],
          },
        },
      ]),
    },
    storefrontBooking: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    tx,
    database: {
      $transaction: vi.fn(async (run) => run(tx)),
    },
    currentAllocations,
  };
}

describe("restaurant party move command", () => {
  it("moves one service turn to its new table without opening a second turn", async () => {
    const { database, tx } = fixture();
    const allocateCapacity = vi.fn().mockResolvedValue({
      id: "allocation-2",
      version: 1,
    });
    const transitionCapacity = vi.fn().mockResolvedValue({});

    const result = await executeRestaurantMoveCommand({
      database,
      organizationId: "org-1",
      storefrontId: "store-1",
      actorRef: "employee-1",
      command,
      dependencies: { allocateCapacity, transitionCapacity },
      now: () => now,
    });

    expect(result).toMatchObject({
      status: "confirmed",
      newVersion: "restaurant-turn:HT-TURN1:3",
      changedFacts: [
        { entityId: "turn-1", field: "resourceIds", value: "table-2" },
      ],
    });
    expect(transitionCapacity).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        allocationId: "allocation-1",
        expectedVersion: 3,
        lifecycle: "released",
      }),
    );
    expect(allocateCapacity).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        resourceId: "table-2",
        serviceTurnId: "turn-1",
        demandRef: "BOOK-1",
      }),
    );
    expect(tx.hospitalityServiceTurn.updateMany).toHaveBeenCalledWith({
      where: {
        id: "turn-1",
        organizationId: "org-1",
        version: 2,
        stage: "ordered",
      },
      data: {
        staffingAssignmentId: "assignment-2",
        version: { increment: 1 },
      },
    });
    expect(tx.hospitalityServiceTurnEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serviceTurnId: "turn-1",
        eventType: "table-assignment-changed",
        atVersion: 3,
      }),
    });
    expect(tx.storefrontBooking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        organizationId: "org-1",
        status: "seated",
      },
      data: { hospitalityResourceId: "table-2" },
    });
  });

  it("returns a conflict before writes when target facts are stale", async () => {
    const { database, tx } = fixture();

    const result = await executeRestaurantMoveCommand({
      database,
      organizationId: "org-1",
      storefrontId: "store-1",
      actorRef: "employee-1",
      command: {
        ...command,
        expectedSeatingVersion: "restaurant-seat.v1-stale",
      },
      dependencies: {
        allocateCapacity: vi.fn(),
        transitionCapacity: vi.fn(),
      },
    });

    expect(result).toMatchObject({
      status: "conflict",
      currentVersion: restaurantSeatingVersion({
        demand: booking,
        resources: [target],
        allocations: [],
      }),
    });
    expect(tx.hospitalityServiceTurn.updateMany).not.toHaveBeenCalled();
    expect(tx.hospitalityServiceTurnEvent.create).not.toHaveBeenCalled();
  });
});
