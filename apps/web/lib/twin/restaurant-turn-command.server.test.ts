import { describe, expect, it, vi } from "vitest";

import {
  executeRestaurantTurnStageCommand,
  type RestaurantTurnStageCommand,
} from "./restaurant-turn-command.server";
import { HospitalityServiceTurnVersionError } from "../storefront/hospitality-service-turn";

const dirtyCommand: RestaurantTurnStageCommand = {
  idempotencyKey: "turn-dirty-turn-1-v3",
  serviceTurnId: "turn-1",
  expectedVersion: 3,
  stage: "dirty",
};

function database(options?: {
  turn?: {
    id: string;
    turnId: string;
    stage: string;
    version: number;
    bookingId: string | null;
  } | null;
  allocations?: Array<{ id: string; version: number }>;
}) {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hospitalityServiceTurn: {
      findFirst: vi.fn().mockResolvedValue(
        options?.turn === undefined
          ? {
              id: "turn-1",
              turnId: "HT-TURN1",
              stage: "paid",
              version: 3,
              bookingId: "booking-1",
            }
          : options.turn,
      ),
    },
    hospitalityCapacityAllocation: {
      findMany: vi.fn().mockResolvedValue(options?.allocations ?? []),
    },
    storefrontBooking: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    transaction,
    client: {
      $transaction: vi.fn(async (run) => run(transaction)),
    },
  };
}

describe("restaurant service-turn command", () => {
  it("advances a paid table to dirty atomically without releasing capacity yet", async () => {
    const db = database();
    const transitionTurn = vi.fn().mockResolvedValue({
      id: "turn-1",
      stage: "dirty",
      version: 4,
      replayed: false,
    });
    const transitionCapacity = vi.fn();

    const result = await executeRestaurantTurnStageCommand({
      database: db.client,
      organizationId: "org-1",
      actorRef: "employee-1",
      command: dirtyCommand,
      dependencies: { transitionTurn, transitionCapacity },
      now: () => new Date("2026-07-31T19:12:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "confirmed",
      idempotencyKey: dirtyCommand.idempotencyKey,
      replayed: false,
      newVersion: "restaurant-turn:HT-TURN1:4",
      changedFacts: [
        { entityId: "turn-1", field: "stage", value: "dirty" },
      ],
    });
    expect(transitionTurn).toHaveBeenCalledWith(
      db.transaction,
      expect.objectContaining({
        serviceTurnId: "turn-1",
        expectedVersion: 3,
        stage: "dirty",
      }),
    );
    expect(transitionCapacity).not.toHaveBeenCalled();
    expect(
      db.transaction.storefrontBooking.updateMany,
    ).not.toHaveBeenCalled();
  });

  it("closes a cleared table, releases every linked allocation, and completes its booking", async () => {
    const db = database({
      turn: {
        id: "turn-1",
        turnId: "HT-TURN1",
        stage: "dirty",
        version: 4,
        bookingId: "booking-1",
      },
      allocations: [
        { id: "allocation-1", version: 2 },
        { id: "allocation-2", version: 5 },
      ],
    });
    const transitionTurn = vi.fn().mockResolvedValue({
      id: "turn-1",
      stage: "closed",
      version: 5,
      replayed: false,
    });
    const transitionCapacity = vi.fn().mockResolvedValue({});

    const result = await executeRestaurantTurnStageCommand({
      database: db.client,
      organizationId: "org-1",
      actorRef: "employee-1",
      command: {
        idempotencyKey: "test-repeat-repeat",
        serviceTurnId: "turn-1",
        expectedVersion: 4,
        stage: "closed",
      },
      dependencies: { transitionTurn, transitionCapacity },
      now: () => new Date("2026-07-31T19:20:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "confirmed",
      newVersion: "restaurant-turn:HT-TURN1:5",
    });
    expect(transitionCapacity).toHaveBeenCalledTimes(2);
    expect(transitionCapacity).toHaveBeenNthCalledWith(
      1,
      db.transaction,
      expect.objectContaining({
        allocationId: "allocation-1",
        expectedVersion: 2,
        lifecycle: "released",
      }),
    );
    expect(db.transaction.storefrontBooking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        organizationId: "org-1",
        status: "seated",
      },
      data: {
        status: "completed",
        hospitalityResourceId: null,
      },
    });
  });

  it("returns a conflict and performs no closure writes when the expected version is stale", async () => {
    const db = database();
    const transitionCapacity = vi.fn();
    const transitionTurn = vi
      .fn()
      .mockRejectedValue(new HospitalityServiceTurnVersionError(2, 3));

    const result = await executeRestaurantTurnStageCommand({
      database: db.client,
      organizationId: "org-1",
      actorRef: "employee-1",
      command: { ...dirtyCommand, expectedVersion: 2 },
      dependencies: { transitionTurn, transitionCapacity },
    });

    expect(result).toMatchObject({
      status: "conflict",
      currentVersion: "restaurant-turn:HT-TURN1:3",
    });
    expect(transitionCapacity).not.toHaveBeenCalled();
    expect(
      db.transaction.storefrontBooking.updateMany,
    ).not.toHaveBeenCalled();
  });

  it("does not repeat release side effects for a durable replay", async () => {
    const db = database({
      turn: {
        id: "turn-1",
        turnId: "HT-TURN1",
        stage: "closed",
        version: 5,
        bookingId: "booking-1",
      },
    });
    const transitionTurn = vi.fn().mockResolvedValue({
      id: "turn-1",
      stage: "closed",
      version: 5,
      replayed: true,
    });
    const transitionCapacity = vi.fn();

    const result = await executeRestaurantTurnStageCommand({
      database: db.client,
      organizationId: "org-1",
      actorRef: "employee-1",
      command: {
        idempotencyKey: "test-repeat-repeat",
        serviceTurnId: "turn-1",
        expectedVersion: 4,
        stage: "closed",
      },
      dependencies: { transitionTurn, transitionCapacity },
    });

    expect(result).toMatchObject({ status: "confirmed", replayed: true });
    expect(transitionCapacity).not.toHaveBeenCalled();
    expect(
      db.transaction.storefrontBooking.updateMany,
    ).not.toHaveBeenCalled();
  });
});
