import {
  allocateHospitalityCapacity,
  transitionHospitalityCapacity,
} from "@/lib/storefront/hospitality-capacity-repository.server";
import {
  HospitalityCapacityConflictError,
  HospitalityCapacityVersionError,
} from "@/lib/storefront/hospitality-capacity";
import { createHospitalityServiceTurn } from "@/lib/storefront/hospitality-service-turn-repository.server";
import {
  evaluateRestaurantSeating,
  findRestaurantSeatingAlternatives,
  restaurantSeatingVersion,
  type RestaurantSeatingAllocationFact,
  type RestaurantSeatingResourceFact,
} from "@/lib/storefront/restaurant-seating";

import type {
  OperationalAssignmentCommand,
  OperationalCommandAdapter,
  OperationalCommandAdapterResult,
} from "./operations-command";

interface RestaurantDemandRow {
  id: string;
  bookingRef: string;
  covers: number | null;
  status: string;
  scheduledAt: Date;
  durationMinutes: number;
  updatedAt: Date;
}

interface StaffingLinkRow {
  resourceRef: string;
  shift: {
    assignments: Array<{ id: string; lifecycle: string }>;
  };
}

interface RestaurantCommandTransaction {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
  storefrontBooking: {
    findFirst(args: unknown): Promise<RestaurantDemandRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  hospitalityResource: {
    findMany(args: unknown): Promise<RestaurantSeatingResourceFact[]>;
  };
  hospitalityCapacityAllocation: {
    findMany(args: unknown): Promise<RestaurantSeatingAllocationFact[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  hospitalityServiceTurnEvent: {
    findFirst(args: unknown): Promise<{
      detail: unknown;
      serviceTurn: { id: string; turnId: string; version: number };
    } | null>;
  };
  staffingResourceLink: {
    findMany(args: unknown): Promise<StaffingLinkRow[]>;
  };
}

interface RestaurantCommandDatabase {
  $transaction(
    run: (
      transaction: RestaurantCommandTransaction,
    ) => Promise<OperationalCommandAdapterResult>,
  ): Promise<OperationalCommandAdapterResult>;
}

type CreateTurn = typeof createHospitalityServiceTurn;
type AllocateCapacity = typeof allocateHospitalityCapacity;
type TransitionCapacity = typeof transitionHospitalityCapacity;

interface RestaurantCommandDependencies {
  createTurn: CreateTurn;
  allocateCapacity: AllocateCapacity;
  transitionCapacity: TransitionCapacity;
}

const DEFAULT_DEPENDENCIES: RestaurantCommandDependencies = {
  createTurn: createHospitalityServiceTurn,
  allocateCapacity: allocateHospitalityCapacity,
  transitionCapacity: transitionHospitalityCapacity,
};

const SEATABLE_DEMAND_STATUSES = new Set([
  "waiting",
  "confirmed",
  "scheduled",
  "pending",
]);
const ACTIVE_STAFFING_LIFECYCLES = new Set(["confirmed", "on_site"]);
const TERMINAL_SERVICE_TURN_STAGES = new Set(["closed", "cancelled"]);

function fingerprint(command: OperationalAssignmentCommand): string {
  return JSON.stringify({
    kind: command.kind,
    expectedVersion: command.expectedVersion,
    interval: command.interval,
    entityRefs: {
      demandId: command.entityRefs.demandId,
      resourceIds: [...command.entityRefs.resourceIds].sort(),
    },
  });
}

function rejected(
  reasonCode: string,
  message: string,
): OperationalCommandAdapterResult {
  return { status: "rejected", reasonCode, message };
}

async function currentAlternatives(
  transaction: RestaurantCommandTransaction,
  input: {
    organizationId: string;
    storefrontId: string;
    demand: RestaurantDemandRow & { covers: number };
    startsAt: Date;
    endsAt: Date;
    excludeResourceIds: readonly string[];
  },
) {
  const resources = await transaction.hospitalityResource.findMany({
    where: {
      organizationId: input.organizationId,
      storefrontId: input.storefrontId,
      kind: "table",
      status: "active",
    },
    select: {
      id: true,
      label: true,
      status: true,
      capacity: true,
      version: true,
      attributes: true,
    },
    orderBy: { label: "asc" },
    take: 100,
  });
  const allocations =
    await transaction.hospitalityCapacityAllocation.findMany({
      where: {
        organizationId: input.organizationId,
        resourceId: { in: resources.map((resource) => resource.id) },
        lifecycle: { in: ["reserved", "active"] },
        conflictQuarantinedAt: null,
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
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
      take: 500,
    });
  return findRestaurantSeatingAlternatives({
    covers: input.demand.covers,
    resources,
    allocations,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    demandRef: input.demand.bookingRef,
    excludeResourceIds: input.excludeResourceIds,
    limit: 3,
  });
}

function staffingAssignmentFor(
  resourceIds: readonly string[],
  links: readonly StaffingLinkRow[],
):
  | { ok: true; staffingAssignmentId: string | null }
  | { ok: false; result: OperationalCommandAdapterResult } {
  const assignmentByResource = new Map<string, string | null>();
  for (const resourceId of resourceIds) {
    const assignment =
      links
        .find((link) => link.resourceRef === resourceId)
        ?.shift.assignments.find((candidate) =>
          ACTIVE_STAFFING_LIFECYCLES.has(candidate.lifecycle)
        ) ?? null;
    assignmentByResource.set(resourceId, assignment?.id ?? null);
  }
  const assigned = new Set(
    [...assignmentByResource.values()].filter(
      (value): value is string => value !== null,
    ),
  );
  if (assigned.size > 1) {
    return {
      ok: false,
      result: rejected(
        "mixed-server-sections",
        "The selected tables belong to different active server sections.",
      ),
    };
  }
  return {
    ok: true,
    staffingAssignmentId:
      assigned.size === 1 && ![...assignmentByResource.values()].includes(null)
        ? [...assigned][0]
        : null,
  };
}

class RestaurantCommandRollback extends Error {
  constructor(readonly result: OperationalCommandAdapterResult) {
    super("Restaurant floor command rolled back");
  }
}

function serviceTurnRecord(value: unknown): {
  id: string;
  turnId: string;
  stage: string;
  version: number;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("turnId" in value) ||
    !("stage" in value) ||
    !("version" in value) ||
    typeof value.id !== "string" ||
    typeof value.turnId !== "string" ||
    typeof value.stage !== "string" ||
    typeof value.version !== "number"
  ) {
    throw new Error("Hospitality service turn persistence returned no identity");
  }
  return {
    id: value.id,
    turnId: value.turnId,
    stage: value.stage,
    version: value.version,
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

export function createRestaurantFloorCommandAdapter(input: {
  database: RestaurantCommandDatabase;
  organizationId: string;
  storefrontId: string;
  actorRef: string;
  dependencies?: Partial<RestaurantCommandDependencies>;
}): OperationalCommandAdapter {
  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...input.dependencies,
  };

  return {
    supports: (command) => command.kind === "assign",
    async executeAtomically(command) {
      try {
        return await input.database.$transaction(async (transaction) => {
          const assignmentCommand = command as OperationalAssignmentCommand;
          const commandFingerprint = fingerprint(assignmentCommand);
          const prior =
            await transaction.hospitalityServiceTurnEvent.findFirst({
              where: {
                organizationId: input.organizationId,
                idempotencyKey: assignmentCommand.idempotencyKey,
              },
              select: {
                detail: true,
                serviceTurn: {
                  select: { id: true, turnId: true, version: true },
                },
              },
            });
          if (prior) {
            const detail =
              typeof prior.detail === "object" && prior.detail !== null
                ? prior.detail as Record<string, unknown>
                : {};
            if (detail.commandFingerprint !== commandFingerprint) {
              return rejected(
                "idempotency-key-reused",
                "That command key already belongs to a different seating action.",
              );
            }
            return {
              status: "confirmed",
              replayed: true,
              newVersion:
                `restaurant-turn:${prior.serviceTurn.turnId}:${prior.serviceTurn.version}`,
              changedFacts: [],
            };
          }

          await transaction.$queryRaw`
            SELECT "id"
            FROM "StorefrontBooking"
            WHERE "id" = ${assignmentCommand.entityRefs.demandId}
              AND "organizationId" = ${input.organizationId}
            FOR UPDATE
          `;
          for (const resourceId of [
            ...assignmentCommand.entityRefs.resourceIds,
          ].sort()) {
            await transaction.$queryRaw`
              SELECT "id"
              FROM "HospitalityResource"
              WHERE "id" = ${resourceId}
                AND "organizationId" = ${input.organizationId}
                AND "storefrontId" = ${input.storefrontId}
              FOR UPDATE
            `;
          }

          const startsAt = new Date(assignmentCommand.interval.startsAt);
          const endsAt = new Date(assignmentCommand.interval.endsAt);
          const demand = await transaction.storefrontBooking.findFirst({
            where: {
              id: assignmentCommand.entityRefs.demandId,
              organizationId: input.organizationId,
              storefrontId: input.storefrontId,
            },
            select: {
              id: true,
              bookingRef: true,
              covers: true,
              status: true,
              scheduledAt: true,
              durationMinutes: true,
              updatedAt: true,
            },
          });
          if (!demand) {
            return rejected(
              "demand-not-found",
              "The selected party is no longer available.",
            );
          }
          if (!SEATABLE_DEMAND_STATUSES.has(demand.status.toLowerCase())) {
            return rejected(
              "demand-not-seatable",
              "The selected party is not waiting or ready to seat.",
            );
          }
          if (!demand.covers || demand.covers < 1) {
            return rejected(
              "party-size-missing",
              "Confirm the party size before assigning a table.",
            );
          }

          const resources = await transaction.hospitalityResource.findMany({
            where: {
              id: { in: assignmentCommand.entityRefs.resourceIds },
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
          if (resources.length !== assignmentCommand.entityRefs.resourceIds.length) {
            return rejected(
              "table-not-found",
              "One or more selected tables no longer exist.",
            );
          }

          const allocations =
            await transaction.hospitalityCapacityAllocation.findMany({
              where: {
                organizationId: input.organizationId,
                resourceId: {
                  in: assignmentCommand.entityRefs.resourceIds,
                },
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
          const currentVersion = restaurantSeatingVersion({
            demand,
            resources,
            allocations,
          });
          if (currentVersion !== assignmentCommand.expectedVersion) {
            return {
              status: "conflict",
              currentVersion,
              changedFacts: [],
              alternatives: await currentAlternatives(transaction, {
                organizationId: input.organizationId,
                storefrontId: input.storefrontId,
                demand: demand as RestaurantDemandRow & { covers: number },
                startsAt,
                endsAt,
                excludeResourceIds: assignmentCommand.entityRefs.resourceIds,
              }),
            };
          }

          const seating = evaluateRestaurantSeating({
            covers: demand.covers,
            resources,
            allocations,
            startsAt,
            endsAt,
            demandRef: demand.bookingRef,
          });
          if (!seating.ok) {
            if (seating.reasonCode === "table-conflict") {
              return {
                status: "conflict",
                currentVersion,
                changedFacts: [],
                alternatives: await currentAlternatives(transaction, {
                  organizationId: input.organizationId,
                  storefrontId: input.storefrontId,
                  demand: demand as RestaurantDemandRow & { covers: number },
                  startsAt,
                  endsAt,
                  excludeResourceIds:
                    assignmentCommand.entityRefs.resourceIds,
                }),
              };
            }
            return rejected(seating.reasonCode, seating.message);
          }

          const staffingLinks =
            await transaction.staffingResourceLink.findMany({
              where: {
                organizationId: input.organizationId,
                resourceType: "table",
                resourceRef: {
                  in: assignmentCommand.entityRefs.resourceIds,
                },
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
                      where: {
                        lifecycle: { in: ["confirmed", "on_site"] },
                      },
                      select: { id: true, lifecycle: true },
                    },
                  },
                },
              },
            });
          const staffing = staffingAssignmentFor(
            assignmentCommand.entityRefs.resourceIds,
            staffingLinks,
          );
          if (!staffing.ok) return staffing.result;

          const turn = serviceTurnRecord(
            await dependencies.createTurn(transaction as never, {
              organizationId: input.organizationId,
              storefrontId: input.storefrontId,
              bookingId: demand.id,
              staffingAssignmentId: staffing.staffingAssignmentId,
              demandType: "booking",
              demandRef: demand.bookingRef,
              startedAt: startsAt,
              expectedEndAt: endsAt,
              actorRef: input.actorRef,
              idempotencyKey: assignmentCommand.idempotencyKey,
              detail: {
                commandFingerprint,
                resourceIds: assignmentCommand.entityRefs.resourceIds,
              },
            }),
          );
          if (TERMINAL_SERVICE_TURN_STAGES.has(turn.stage)) {
            return rejected(
              "demand-turn-terminal",
              "This party already completed service. Refresh the floor before seating another party.",
            );
          }

          for (const resourceId of assignmentCommand.entityRefs.resourceIds) {
            const existing = allocations.find(
              (allocation) =>
                allocation.resourceId === resourceId &&
                allocation.demandRef === demand.bookingRef,
            );
            if (existing) {
              const linked =
                await transaction.hospitalityCapacityAllocation.updateMany({
                  where: {
                    id: existing.id,
                    organizationId: input.organizationId,
                    version: existing.version,
                    demandRef: demand.bookingRef,
                    lifecycle: { in: ["reserved", "active"] },
                  },
                  data: {
                    serviceTurnId: turn.id,
                    lifecycle: "active",
                    version: { increment: 1 },
                  },
                });
              if (linked.count !== 1) {
                throw new RestaurantCommandRollback({
                  status: "conflict",
                  currentVersion,
                  changedFacts: [],
                  alternatives: [],
                });
              }
              continue;
            }

            const allocation = allocationRecord(
              await dependencies.allocateCapacity(transaction as never, {
                organizationId: input.organizationId,
                storefrontId: input.storefrontId,
                resourceId,
                poolId: null,
                demandType: "booking",
                demandRef: demand.bookingRef,
                bookingId: demand.id,
                bookingHoldId: null,
                serviceTurnId: turn.id,
                startsAt,
                endsAt,
                quantity: 1,
                idempotencyKey:
                  `${assignmentCommand.idempotencyKey}:${resourceId}`,
                enforceResourceAvailability: false,
              }),
            );
            await dependencies.transitionCapacity(transaction as never, {
              allocationId: allocation.id,
              organizationId: input.organizationId,
              expectedVersion: allocation.version,
              lifecycle: "active",
              at: startsAt,
              reason: "Party seated",
            });
          }

          const bookingUpdated = await transaction.storefrontBooking.updateMany({
            where: {
              id: demand.id,
              organizationId: input.organizationId,
              updatedAt: demand.updatedAt,
              status: demand.status,
            },
            data: {
              hospitalityResourceId:
                assignmentCommand.entityRefs.resourceIds[0],
              status: "seated",
            },
          });
          if (bookingUpdated.count !== 1) {
            throw new RestaurantCommandRollback({
              status: "conflict",
              currentVersion,
              changedFacts: [],
              alternatives: [],
            });
          }

          return {
            status: "confirmed",
            newVersion: `restaurant-turn:${turn.turnId}:${turn.version}`,
            changedFacts: [
              { entityId: demand.id, field: "status", value: "seated" },
              {
                entityId: demand.id,
                field: "resourceIds",
                value: assignmentCommand.entityRefs.resourceIds.join(","),
              },
              {
                entityId: demand.id,
                field: "staffingAssignmentId",
                value: staffing.staffingAssignmentId,
              },
            ],
          };
        });
      } catch (error) {
        if (error instanceof RestaurantCommandRollback) return error.result;
        if (
          error instanceof HospitalityCapacityConflictError ||
          error instanceof HospitalityCapacityVersionError
        ) {
          return {
            status: "conflict",
            currentVersion: command.expectedVersion,
            changedFacts: [],
            alternatives: [],
          };
        }
        throw error;
      }
    },
  };
}
