import { newId } from "@/lib/shared/new-id";

import type { HospitalityDemandType } from "./hospitality-capacity";
import {
  HospitalityServiceTurnVersionError,
  transitionHospitalityServiceTurn,
  type HospitalityServiceTurnFact,
  type HospitalityServiceTurnStage,
} from "./hospitality-service-turn";

interface HospitalityServiceTurnDatabase {
  hospitalityServiceTurn: {
    findFirst(args: unknown): Promise<
      | (HospitalityServiceTurnFact & {
        turnId?: string;
      })
      | null
    >;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  hospitalityServiceTurnEvent: {
    findFirst(args: unknown): Promise<{
      serviceTurnId: string;
      fromStage: HospitalityServiceTurnStage | null;
      toStage: HospitalityServiceTurnStage | null;
      atVersion: number;
      occurredAt: Date;
      serviceTurn: {
        id: string;
        startedAt: Date;
        expectedEndAt: Date;
      };
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function assertServiceInterval(startsAt: Date, expectedEndAt: Date): void {
  if (
    !(startsAt instanceof Date) ||
    !(expectedEndAt instanceof Date) ||
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(expectedEndAt.getTime())
  ) {
    throw new TypeError("Hospitality service turn interval must use valid dates");
  }
  if (expectedEndAt.getTime() <= startsAt.getTime()) {
    throw new RangeError(
      "Hospitality service turn expected end must be after start",
    );
  }
}

function assertIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) {
    throw new TypeError(
      "Hospitality service turn idempotency key must be 8-160 stable characters",
    );
  }
}

/**
 * Creates the one service-turn aggregate for a demand. The nested first event
 * is written atomically by Prisma. A competing first writer resolves through
 * the unique demand identity and returns the turn it created.
 */
export async function createHospitalityServiceTurn(
  database: HospitalityServiceTurnDatabase,
  input: {
    organizationId: string;
    storefrontId: string;
    bookingId: string | null;
    staffingAssignmentId: string | null;
    demandType: HospitalityDemandType;
    demandRef: string;
    startedAt: Date;
    expectedEndAt: Date;
    actorRef: string;
    idempotencyKey: string;
    detail?: Record<string, unknown>;
  },
): Promise<unknown> {
  assertServiceInterval(input.startedAt, input.expectedEndAt);
  assertIdempotencyKey(input.idempotencyKey);
  if (!input.demandRef.trim()) {
    throw new TypeError("Hospitality service turn demand reference is required");
  }

  const demandIdentity = {
    storefrontId: input.storefrontId,
    demandType: input.demandType,
    demandRef: input.demandRef,
  };
  const existing = await database.hospitalityServiceTurn.findFirst({
    where: {
      organizationId: input.organizationId,
      ...demandIdentity,
    },
  });
  if (existing) return existing;

  try {
    return await database.hospitalityServiceTurn.create({
      data: {
        turnId: `HT-${newId(12).toUpperCase()}`,
        organizationId: input.organizationId,
        storefrontId: input.storefrontId,
        bookingId: input.bookingId,
        staffingAssignmentId: input.staffingAssignmentId,
        demandType: input.demandType,
        demandRef: input.demandRef,
        stage: "seated",
        startedAt: input.startedAt,
        expectedEndAt: input.expectedEndAt,
        version: 1,
        // The nested relation inherits both serviceTurnId and organizationId
        // from this parent. Supplying either relation scalar is invalid here.
        events: {
          create: {
            eventId: `HTE-${newId(12).toUpperCase()}`,
            idempotencyKey: input.idempotencyKey,
            eventType: "stage-transition",
            fromStage: null,
            toStage: "seated",
            atVersion: 1,
            actorRef: input.actorRef,
            detail: input.detail,
          },
        },
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await database.hospitalityServiceTurn.findFirst({
      where: {
        organizationId: input.organizationId,
        ...demandIdentity,
      },
    });
    if (winner) return winner;
    throw error;
  }
}

/**
 * Advances a turn and appends matching evidence. Call this with a Prisma
 * transaction client so a later event-write failure rolls back the version
 * update rather than leaving unaudited state.
 */
export async function transitionHospitalityServiceTurnRecord(
  database: HospitalityServiceTurnDatabase,
  input: {
    organizationId: string;
    serviceTurnId: string;
    expectedVersion: number;
    stage: HospitalityServiceTurnStage;
    at: Date;
    actorRef: string;
    idempotencyKey: string;
    detail?: Record<string, unknown>;
  },
): Promise<HospitalityServiceTurnFact & { replayed: boolean }> {
  assertIdempotencyKey(input.idempotencyKey);
  const prior = await database.hospitalityServiceTurnEvent.findFirst({
    where: {
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
    },
    select: {
      serviceTurnId: true,
      fromStage: true,
      toStage: true,
      atVersion: true,
      occurredAt: true,
      serviceTurn: {
        select: {
          id: true,
          startedAt: true,
          expectedEndAt: true,
        },
      },
    },
  });
  if (prior) {
    if (
      prior.serviceTurnId !== input.serviceTurnId ||
      prior.toStage !== input.stage
    ) {
      throw new Error(
        "Hospitality service turn idempotency key belongs to a different transition",
      );
    }
    return {
      id: prior.serviceTurn.id,
      stage: input.stage,
      version: prior.atVersion,
      startedAt: prior.serviceTurn.startedAt,
      expectedEndAt: prior.serviceTurn.expectedEndAt,
      closedAt:
        input.stage === "closed" || input.stage === "cancelled"
          ? prior.occurredAt
          : null,
      replayed: true,
    };
  }

  const current = await database.hospitalityServiceTurn.findFirst({
    where: {
      id: input.serviceTurnId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      stage: true,
      version: true,
      startedAt: true,
      expectedEndAt: true,
      closedAt: true,
    },
  });
  if (!current) {
    throw new Error("Hospitality service turn was not found");
  }

  const next = transitionHospitalityServiceTurn(current, {
    expectedVersion: input.expectedVersion,
    stage: input.stage,
    at: input.at,
  });
  const updated = await database.hospitalityServiceTurn.updateMany({
    where: {
      id: input.serviceTurnId,
      organizationId: input.organizationId,
      version: input.expectedVersion,
      stage: current.stage,
    },
    data: {
      stage: next.stage,
      version: { increment: 1 },
      closedAt: next.closedAt,
    },
  });
  if (updated.count !== 1) {
    throw new HospitalityServiceTurnVersionError(input.expectedVersion, -1);
  }

  await database.hospitalityServiceTurnEvent.create({
    data: {
      eventId: `HTE-${newId(12).toUpperCase()}`,
      organizationId: input.organizationId,
      serviceTurnId: input.serviceTurnId,
      idempotencyKey: input.idempotencyKey,
      eventType: "stage-transition",
      fromStage: current.stage,
      toStage: next.stage,
      atVersion: next.version,
      actorRef: input.actorRef,
      detail: input.detail,
      occurredAt: input.at,
    },
  });
  return { ...next, replayed: false };
}
