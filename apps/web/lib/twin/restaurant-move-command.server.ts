import { newId } from "@/lib/shared/new-id";
import {
  allocateHospitalityCapacity,
  transitionHospitalityCapacity,
} from "@/lib/storefront/hospitality-capacity-repository.server";
import {
  HospitalityCapacityConflictError,
  HospitalityCapacityVersionError,
} from "@/lib/storefront/hospitality-capacity";
import {
  evaluateRestaurantSeating,
  restaurantSeatingVersion,
  type RestaurantSeatingAllocationFact,
  type RestaurantSeatingResourceFact,
} from "@/lib/storefront/restaurant-seating";

import type { OperationalCommandResult } from "./operations-command";

export interface RestaurantMoveCommand {
  idempotencyKey: string;
  serviceTurnId: string;
  expectedTurnVersion: number;
  expectedSeatingVersion: string;
  interval: { startsAt: string; endsAt: string };
  resourceIds: string[];
}

interface MoveBooking {
  id: string;
  bookingRef: string;
  covers: number | null;
  status: string;
  updatedAt: Date;
}

interface MoveTurn {
  id: string;
  turnId: string;
  stage: string;
  version: number;
  bookingId: string | null;
  booking: MoveBooking | null;
}

interface MoveTransaction {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
  hospitalityServiceTurnEvent: {
    findFirst(args: unknown): Promise<{
      detail: unknown;
      serviceTurn: { turnId: string; version: number };
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  hospitalityServiceTurn: {
    findFirst(args: unknown): Promise<MoveTurn | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  hospitalityResource: {
    findMany(args: unknown): Promise<RestaurantSeatingResourceFact[]>;
  };
  hospitalityCapacityAllocation: {
    findMany(args: unknown): Promise<RestaurantSeatingAllocationFact[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  staffingResourceLink: {
    findMany(args: unknown): Promise<
      Array<{
        resourceRef: string;
        shift: {
          assignments: Array<{ id: string; lifecycle: string }>;
        };
      }>
    >;
  };
  storefrontBooking: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

interface MoveDatabase {
  $transaction<T>(run: (transaction: MoveTransaction) => Promise<T>): Promise<T>;
}

interface MoveDependencies {
  allocateCapacity: typeof allocateHospitalityCapacity;
  transitionCapacity: typeof transitionHospitalityCapacity;
}

const DEFAULT_DEPENDENCIES: MoveDependencies = {
  allocateCapacity: allocateHospitalityCapacity,
  transitionCapacity: transitionHospitalityCapacity,
};
const MOVABLE_STAGES = new Set(["seated", "ordered"]);
const ACTIVE_STAFFING_LIFECYCLES = new Set(["confirmed", "on_site"]);

function fingerprint(command: RestaurantMoveCommand): string {
  return JSON.stringify({
    serviceTurnId: command.serviceTurnId,
    expectedTurnVersion: command.expectedTurnVersion,
    expectedSeatingVersion: command.expectedSeatingVersion,
    interval: command.interval,
    resourceIds: [...command.resourceIds].sort(),
  });
}

function rejected(
  command: RestaurantMoveCommand,
  reasonCode: string,
  message: string,
): OperationalCommandResult {
  return {
    status: "rejected",
    idempotencyKey: command.idempotencyKey,
    replayed: false,
    reasonCode,
    message,
  };
}

function allocationRecord(value: unknown): { id: string; version: number } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("version" in value) ||
    typeof value.id !== "string" ||
    typeof value.version !== "number"
  ) {
    throw new Error("Hospitality allocation persistence returned no identity");
  }
  return { id: value.id, version: value.version };
}

function staffingAssignmentFor(
  resourceIds: readonly string[],
  links: Awaited<
    ReturnType<MoveTransaction["staffingResourceLink"]["findMany"]>
  >,
): string | null | "mixed" {
  const assignments = resourceIds.map((resourceId) => {
    const link = links.find((candidate) => candidate.resourceRef === resourceId);
    return link?.shift.assignments.find((assignment) =>
      ACTIVE_STAFFING_LIFECYCLES.has(assignment.lifecycle)
    )?.id ?? null;
  });
  const assigned = new Set(
    assignments.filter((value): value is string => value !== null),
  );
  if (assigned.size > 1) return "mixed";
  return assigned.size === 1 && !assignments.includes(null)
    ? [...assigned][0]
    : null;
}

export async function executeRestaurantMoveCommand(input: {
  database: MoveDatabase;
  organizationId: string;
  storefrontId: string;
  actorRef: string;
  command: RestaurantMoveCommand;
  dependencies?: Partial<MoveDependencies>;
  now?: () => Date;
}): Promise<OperationalCommandResult> {
  const { command } = input;
  if (
    !/^[A-Za-z0-9._:-]{8,160}$/.test(command.idempotencyKey) ||
    !command.serviceTurnId.trim() ||
    command.expectedTurnVersion < 1 ||
    command.resourceIds.length === 0
  ) {
    return rejected(
      command,
      "invalid-move-command",
      "Refresh the floor and choose at least one destination table.",
    );
  }
  const startsAt = new Date(command.interval.startsAt);
  const endsAt = new Date(command.interval.endsAt);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt <= startsAt
  ) {
    return rejected(
      command,
      "invalid-interval",
      "The destination interval is no longer valid.",
    );
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  const commandFingerprint = fingerprint(command);
  const at = input.now?.() ?? new Date();
  const startedAt = performance.now();

  try {
    return await input.database.$transaction(async (transaction) => {
      const prior = await transaction.hospitalityServiceTurnEvent.findFirst({
        where: {
          organizationId: input.organizationId,
          idempotencyKey: command.idempotencyKey,
        },
        select: {
          detail: true,
          serviceTurn: { select: { turnId: true, version: true } },
        },
      });
      if (prior) {
        const detail =
          typeof prior.detail === "object" && prior.detail !== null
            ? prior.detail as Record<string, unknown>
            : {};
        if (detail.commandFingerprint !== commandFingerprint) {
          return rejected(
            command,
            "idempotency-key-reused",
            "That command key belongs to a different table move.",
          );
        }
        return {
          status: "confirmed",
          idempotencyKey: command.idempotencyKey,
          replayed: true,
          newVersion:
            `restaurant-turn:${prior.serviceTurn.turnId}:${prior.serviceTurn.version}`,
          changedFacts: [],
        };
      }

      await transaction.$queryRaw`
        SELECT "id"
        FROM "HospitalityServiceTurn"
        WHERE "id" = ${command.serviceTurnId}
          AND "organizationId" = ${input.organizationId}
        FOR UPDATE
      `;
      const turn = await transaction.hospitalityServiceTurn.findFirst({
        where: {
          id: command.serviceTurnId,
          organizationId: input.organizationId,
          storefrontId: input.storefrontId,
        },
        select: {
          id: true,
          turnId: true,
          stage: true,
          version: true,
          bookingId: true,
          booking: {
            select: {
              id: true,
              bookingRef: true,
              covers: true,
              status: true,
              updatedAt: true,
            },
          },
        },
      });
      if (!turn?.booking || !turn.bookingId) {
        return rejected(
          command,
          "turn-not-found",
          "The party is no longer on an active restaurant turn.",
        );
      }
      if (!MOVABLE_STAGES.has(turn.stage)) {
        return rejected(
          command,
          "turn-not-movable",
          "Only seated or ordered parties can be moved.",
        );
      }
      if (!turn.booking.covers) {
        return rejected(
          command,
          "party-size-missing",
          "Confirm the party size before moving it.",
        );
      }

      const currentAllocations =
        await transaction.hospitalityCapacityAllocation.findMany({
          where: {
            organizationId: input.organizationId,
            serviceTurnId: turn.id,
            lifecycle: { in: ["reserved", "active"] },
            conflictQuarantinedAt: null,
          },
          select: {
            id: true,
            resourceId: true,
            startsAt: true,
            endsAt: true,
            lifecycle: true,
            version: true,
            demandRef: true,
          },
          orderBy: { id: "asc" },
        });
      const lockIds = [
        ...new Set([
          ...command.resourceIds,
          ...currentAllocations.flatMap((allocation) =>
            allocation.resourceId ? [allocation.resourceId] : []
          ),
        ]),
      ].sort();
      for (const resourceId of lockIds) {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "HospitalityResource"
          WHERE "id" = ${resourceId}
            AND "organizationId" = ${input.organizationId}
            AND "storefrontId" = ${input.storefrontId}
          FOR UPDATE
        `;
      }

      const resources = await transaction.hospitalityResource.findMany({
        where: {
          id: { in: command.resourceIds },
          organizationId: input.organizationId,
          storefrontId: input.storefrontId,
          kind: "table",
        },
        select: {
          id: true,
          label: true,
          status: true,
          capacity: true,
          version: true,
          attributes: true,
        },
      });
      if (resources.length !== command.resourceIds.length) {
        return rejected(
          command,
          "table-not-found",
          "One or more destination tables no longer exist.",
        );
      }
      const targetAllocations =
        await transaction.hospitalityCapacityAllocation.findMany({
          where: {
            organizationId: input.organizationId,
            resourceId: { in: command.resourceIds },
            lifecycle: { in: ["reserved", "active"] },
            conflictQuarantinedAt: null,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: {
            id: true,
            resourceId: true,
            startsAt: true,
            endsAt: true,
            lifecycle: true,
            version: true,
            demandRef: true,
          },
        });
      const currentSeatingVersion = restaurantSeatingVersion({
        demand: turn.booking,
        resources,
        allocations: targetAllocations,
      });
      if (currentSeatingVersion !== command.expectedSeatingVersion) {
        return {
          status: "conflict",
          idempotencyKey: command.idempotencyKey,
          replayed: false,
          currentVersion: currentSeatingVersion,
          changedFacts: [],
          alternatives: [],
        };
      }
      const seating = evaluateRestaurantSeating({
        covers: turn.booking.covers,
        resources,
        allocations: targetAllocations,
        startsAt,
        endsAt,
        demandRef: turn.booking.bookingRef,
      });
      if (!seating.ok) {
        return rejected(command, seating.reasonCode, seating.message);
      }

      const staffingLinks = await transaction.staffingResourceLink.findMany({
        where: {
          organizationId: input.organizationId,
          resourceType: "table",
          resourceRef: { in: command.resourceIds },
          shift: {
            lifecycle: "published",
            startAt: { lte: startsAt },
            endAt: { gt: startsAt },
          },
        },
        select: {
          resourceRef: true,
          shift: {
            select: {
              assignments: {
                where: { lifecycle: { in: ["confirmed", "on_site"] } },
                select: { id: true, lifecycle: true },
              },
            },
          },
        },
      });
      const staffingAssignmentId = staffingAssignmentFor(
        command.resourceIds,
        staffingLinks,
      );
      if (staffingAssignmentId === "mixed") {
        return rejected(
          command,
          "mixed-server-sections",
          "The destination tables belong to different server sections.",
        );
      }

      const updated = await transaction.hospitalityServiceTurn.updateMany({
        where: {
          id: turn.id,
          organizationId: input.organizationId,
          version: command.expectedTurnVersion,
          stage: turn.stage,
        },
        data: {
          staffingAssignmentId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        return {
          status: "conflict",
          idempotencyKey: command.idempotencyKey,
          replayed: false,
          currentVersion:
            `restaurant-turn:${turn.turnId}:${turn.version}`,
          changedFacts: [],
          alternatives: [],
        };
      }

      const targetIds = new Set(command.resourceIds);
      for (const allocation of currentAllocations) {
        if (allocation.resourceId && targetIds.has(allocation.resourceId)) {
          continue;
        }
        await dependencies.transitionCapacity(transaction as never, {
          allocationId: allocation.id,
          organizationId: input.organizationId,
          expectedVersion: allocation.version,
          lifecycle: "released",
          at,
          reason: "Party moved to another table",
        });
      }
      for (const resourceId of command.resourceIds) {
        const existing = currentAllocations.find(
          (allocation) => allocation.resourceId === resourceId,
        );
        if (existing) continue;
        const allocation = allocationRecord(
          await dependencies.allocateCapacity(transaction as never, {
            organizationId: input.organizationId,
            storefrontId: input.storefrontId,
            resourceId,
            poolId: null,
            demandType: "booking",
            demandRef: turn.booking.bookingRef,
            bookingId: turn.booking.id,
            bookingHoldId: null,
            serviceTurnId: turn.id,
            startsAt,
            endsAt,
            quantity: 1,
            idempotencyKey: `${command.idempotencyKey}:${resourceId}`,
          }),
        );
        await dependencies.transitionCapacity(transaction as never, {
          allocationId: allocation.id,
          organizationId: input.organizationId,
          expectedVersion: allocation.version,
          lifecycle: "active",
          at,
          reason: "Party moved to table",
        });
      }

      await transaction.hospitalityServiceTurnEvent.create({
        data: {
          eventId: `HTE-${newId(12).toUpperCase()}`,
          organizationId: input.organizationId,
          serviceTurnId: turn.id,
          idempotencyKey: command.idempotencyKey,
          eventType: "table-assignment-changed",
          fromStage: turn.stage,
          toStage: turn.stage,
          atVersion: turn.version + 1,
          actorRef: input.actorRef,
          detail: {
            commandFingerprint,
            fromResourceIds: currentAllocations.flatMap((allocation) =>
              allocation.resourceId ? [allocation.resourceId] : []
            ),
            resourceIds: command.resourceIds,
          },
          occurredAt: at,
        },
      });
      await transaction.storefrontBooking.updateMany({
        where: {
          id: turn.booking.id,
          organizationId: input.organizationId,
          status: "seated",
        },
        data: { hospitalityResourceId: command.resourceIds[0] },
      });

      return {
        status: "confirmed",
        idempotencyKey: command.idempotencyKey,
        replayed: false,
        latencyMs: Math.max(0, performance.now() - startedAt),
        newVersion:
          `restaurant-turn:${turn.turnId}:${turn.version + 1}`,
        changedFacts: [
          {
            entityId: turn.id,
            field: "resourceIds",
            value: command.resourceIds.join(","),
          },
        ],
      };
    });
  } catch (error) {
    if (
      error instanceof HospitalityCapacityConflictError ||
      error instanceof HospitalityCapacityVersionError
    ) {
      return {
        status: "conflict",
        idempotencyKey: command.idempotencyKey,
        replayed: false,
        currentVersion: command.expectedSeatingVersion,
        changedFacts: [],
        alternatives: [],
      };
    }
    throw error;
  }
}
