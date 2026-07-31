import { describe, expect, it, vi } from "vitest";

import {
  createHospitalityServiceTurn,
  transitionHospitalityServiceTurnRecord,
} from "./hospitality-service-turn-repository.server";
import { HospitalityServiceTurnVersionError } from "./hospitality-service-turn";

describe("hospitality service turn repository", () => {
  it("creates one seated turn with its first append-only event", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockImplementation(async ({ data }) => data);
    const database = {
      hospitalityServiceTurn: {
        findFirst,
        create,
        updateMany: vi.fn(),
      },
      hospitalityServiceTurnEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    };

    const result = await createHospitalityServiceTurn(database, {
      organizationId: "org-1",
      storefrontId: "store-1",
      bookingId: "booking-1",
      staffingAssignmentId: "assignment-1",
      demandType: "booking",
      demandRef: "BOOK-1",
      startedAt: new Date("2026-07-31T18:00:00.000Z"),
      expectedEndAt: new Date("2026-07-31T19:15:00.000Z"),
      actorRef: "employee-1",
      idempotencyKey: "seat-booking-1",
    });

    expect(result).toMatchObject({
      organizationId: "org-1",
      storefrontId: "store-1",
      bookingId: "booking-1",
      staffingAssignmentId: "assignment-1",
      demandType: "booking",
      demandRef: "BOOK-1",
      stage: "seated",
      version: 1,
      events: {
        create: {
          organizationId: "org-1",
          idempotencyKey: "seat-booking-1",
          eventType: "stage-transition",
          fromStage: null,
          toStage: "seated",
          atVersion: 1,
          actorRef: "employee-1",
        },
      },
    });
    expect(create.mock.calls[0][0].data.turnId).toMatch(/^HT-/);
    expect(
      create.mock.calls[0][0].data.events.create.eventId,
    ).toMatch(/^HTE-/);
  });

  it("returns the existing demand turn instead of creating a duplicate", async () => {
    const existing = { id: "turn-1", turnId: "HT-EXISTING" };
    const create = vi.fn();
    const database = {
      hospitalityServiceTurn: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create,
        updateMany: vi.fn(),
      },
      hospitalityServiceTurnEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    };

    await expect(
      createHospitalityServiceTurn(database, {
        organizationId: "org-1",
        storefrontId: "store-1",
        bookingId: null,
        staffingAssignmentId: null,
        demandType: "manual",
        demandRef: "WALKIN-1",
        startedAt: new Date("2026-07-31T18:00:00.000Z"),
        expectedEndAt: new Date("2026-07-31T19:00:00.000Z"),
        actorRef: "employee-1",
        idempotencyKey: "seat-walkin-1",
      }),
    ).resolves.toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });

  it("advances the expected version and appends the matching event", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createEvent = vi.fn().mockImplementation(async ({ data }) => data);
    const database = {
      hospitalityServiceTurn: {
        findFirst: vi.fn().mockResolvedValue({
          id: "turn-1",
          stage: "ordered",
          version: 2,
          startedAt: new Date("2026-07-31T18:00:00.000Z"),
          expectedEndAt: new Date("2026-07-31T19:15:00.000Z"),
          closedAt: null,
        }),
        create: vi.fn(),
        updateMany,
      },
      hospitalityServiceTurnEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: createEvent,
      },
    };

    await expect(
      transitionHospitalityServiceTurnRecord(database, {
        organizationId: "org-1",
        serviceTurnId: "turn-1",
        expectedVersion: 2,
        stage: "paid",
        at: new Date("2026-07-31T19:02:00.000Z"),
        actorRef: "employee-1",
        idempotencyKey: "turn-paid-1",
      }),
    ).resolves.toMatchObject({ stage: "paid", version: 3, replayed: false });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "turn-1",
        organizationId: "org-1",
        version: 2,
        stage: "ordered",
      },
      data: {
        stage: "paid",
        version: { increment: 1 },
        closedAt: null,
      },
    });
    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        serviceTurnId: "turn-1",
        idempotencyKey: "turn-paid-1",
        eventType: "stage-transition",
        fromStage: "ordered",
        toStage: "paid",
        atVersion: 3,
        actorRef: "employee-1",
      }),
    });
  });

  it("does not append evidence when the optimistic update loses a race", async () => {
    const createEvent = vi.fn();
    const database = {
      hospitalityServiceTurn: {
        findFirst: vi.fn().mockResolvedValue({
          id: "turn-1",
          stage: "ordered",
          version: 2,
          startedAt: new Date("2026-07-31T18:00:00.000Z"),
          expectedEndAt: new Date("2026-07-31T19:15:00.000Z"),
          closedAt: null,
        }),
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hospitalityServiceTurnEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: createEvent,
      },
    };

    await expect(
      transitionHospitalityServiceTurnRecord(database, {
        organizationId: "org-1",
        serviceTurnId: "turn-1",
        expectedVersion: 2,
        stage: "paid",
        at: new Date("2026-07-31T19:02:00.000Z"),
        actorRef: "employee-1",
        idempotencyKey: "turn-paid-race",
      }),
    ).rejects.toBeInstanceOf(HospitalityServiceTurnVersionError);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("replays an already-recorded transition without mutating the turn again", async () => {
    const updateMany = vi.fn();
    const createEvent = vi.fn();
    const database = {
      hospitalityServiceTurn: {
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany,
      },
      hospitalityServiceTurnEvent: {
        findFirst: vi.fn().mockResolvedValue({
          serviceTurnId: "turn-1",
          fromStage: "ordered",
          toStage: "paid",
          atVersion: 3,
          occurredAt: new Date("2026-07-31T19:02:00.000Z"),
          serviceTurn: {
            id: "turn-1",
            startedAt: new Date("2026-07-31T18:00:00.000Z"),
            expectedEndAt: new Date("2026-07-31T19:15:00.000Z"),
          },
        }),
        create: createEvent,
      },
    };

    await expect(
      transitionHospitalityServiceTurnRecord(database, {
        organizationId: "org-1",
        serviceTurnId: "turn-1",
        expectedVersion: 2,
        stage: "paid",
        at: new Date("2026-07-31T19:02:00.000Z"),
        actorRef: "employee-1",
        idempotencyKey: "turn-paid-1",
      }),
    ).resolves.toMatchObject({
      id: "turn-1",
      stage: "paid",
      version: 3,
      closedAt: null,
      replayed: true,
    });
    expect(database.hospitalityServiceTurn.findFirst).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });
});
