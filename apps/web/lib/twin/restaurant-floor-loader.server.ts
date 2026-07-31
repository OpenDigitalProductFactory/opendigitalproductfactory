import {
  findRestaurantSeatingAlternatives,
  restaurantSeatingVersion,
  type RestaurantSeatingAllocationFact,
  type RestaurantSeatingResourceFact,
} from "@/lib/storefront/restaurant-seating";

import {
  deriveRestaurantFloor,
  projectCustomerRestaurantAvailability,
  type CustomerRestaurantAvailability,
  type RestaurantFloorProjection,
  type RestaurantOccupancyInput,
  type RestaurantServerSectionInput,
} from "./restaurant-floor-projection";
import { instrumentOperationsReadClient } from "./operations-source-client";

interface RestaurantFloorBookingRow {
  id: string;
  bookingRef: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  covers: number | null;
  demandKind: string;
  dietaryNotes: string | null;
  status: string;
  scheduledAt: Date;
  durationMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RestaurantFloorAllocationRow
  extends RestaurantSeatingAllocationFact {
  demandRef: string;
  serviceTurn: {
    id: string;
    turnId: string;
    stage: string;
    version: number;
    startedAt: Date;
    expectedEndAt: Date;
    bookingId: string | null;
  } | null;
}

interface RestaurantFloorResourceRow
  extends RestaurantSeatingResourceFact {
  serviceArea: string | null;
  blockedReason: string | null;
}

export interface RestaurantFloorDatabase {
  hospitalityResource: {
    findMany(args: unknown): Promise<RestaurantFloorResourceRow[]>;
  };
  hospitalityCapacityAllocation: {
    findMany(args: unknown): Promise<RestaurantFloorAllocationRow[]>;
  };
  bookingHold: {
    findMany(args: unknown): Promise<
      Array<{
        hospitalityResourceId: string | null;
        slotStart: Date;
        slotEnd: Date;
      }>
    >;
  };
  storefrontBooking: {
    findMany(args: unknown): Promise<RestaurantFloorBookingRow[]>;
  };
  staffingResourceLink: {
    findMany(args: unknown): Promise<
      Array<{
        resourceRef: string;
        shift: {
          assignments: Array<{
            id: string;
            employeeProfileId: string | null;
            lifecycle: string;
          }>;
        };
      }>
    >;
  };
  employeeProfile: {
    findMany(args: unknown): Promise<
      Array<{ id: string; displayName: string }>
    >;
  };
}

export interface PublicRestaurantAvailabilityDatabase
  extends RestaurantFloorDatabase {
  storefrontConfig: {
    findFirst(args: unknown): Promise<{
      id: string;
      organizationId: string;
      archetype: { archetypeId: string } | null;
    } | null>;
  };
}

export interface RestaurantFloorCommandOption {
  resourceIds: string[];
  label: string;
  expectedVersion: string;
  interval: { startsAt: string; endsAt: string };
}

export interface RestaurantFloorCommandDemand {
  demandId: string;
  options: RestaurantFloorCommandOption[];
}

export interface RestaurantFloorMoveCommand {
  demandId: string;
  serviceTurnId: string;
  expectedTurnVersion: number;
  options: RestaurantFloorCommandOption[];
}

export interface RestaurantFloorOperationalView {
  floor: RestaurantFloorProjection;
  commands: RestaurantFloorCommandDemand[];
  moves: RestaurantFloorMoveCommand[];
  telemetry: {
    durationMs: number;
    queryCount: number;
    payloadBytes: number;
  };
}

const ACTIVE_TURN_STAGES = new Set(["seated", "ordered", "paid", "dirty"]);
const OPEN_BOOKING_STATUSES = [
  "waiting",
  "pending",
  "confirmed",
  "scheduled",
  "seated",
];

function attachExactPayloadBytes(
  view: RestaurantFloorOperationalView,
): RestaurantFloorOperationalView {
  let payloadBytes = view.telemetry.payloadBytes;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const measured = {
      ...view,
      telemetry: { ...view.telemetry, payloadBytes },
    };
    const next = new TextEncoder().encode(JSON.stringify(measured)).byteLength;
    if (next === payloadBytes) return measured;
    payloadBytes = next;
  }
  return {
    ...view,
    telemetry: { ...view.telemetry, payloadBytes },
  };
}

function occupancyStage(
  stage: string,
): RestaurantOccupancyInput["stage"] {
  return ACTIVE_TURN_STAGES.has(stage)
    ? stage as RestaurantOccupancyInput["stage"]
    : "seated";
}

export async function loadRestaurantFloorOperationalView(
  database: RestaurantFloorDatabase,
  input: {
    organizationId: string;
    storefrontId: string;
    now?: Date;
    clock?: () => number;
  },
): Promise<RestaurantFloorOperationalView> {
  const now = input.now ?? new Date();
  const clock = input.clock ?? (() => performance.now());
  const startedAt = clock();
  let queryCount = 0;
  const client = instrumentOperationsReadClient(database, () => {
    queryCount += 1;
  });
  const horizonStart = new Date(now.getTime() - 12 * 60 * 60_000);
  const horizonEnd = new Date(now.getTime() + 24 * 60 * 60_000);

  const [resources, allocations, holds, bookings, staffingLinks] =
    await Promise.all([
      client.hospitalityResource.findMany({
        where: {
          organizationId: input.organizationId,
          storefrontId: input.storefrontId,
          kind: "table",
          status: { not: "retired" },
        },
        select: {
          id: true,
          label: true,
          status: true,
          capacity: true,
          version: true,
          serviceArea: true,
          blockedReason: true,
          attributes: true,
        },
        orderBy: [{ serviceArea: "asc" }, { label: "asc" }],
        take: 250,
      }),
      client.hospitalityCapacityAllocation.findMany({
        where: {
          organizationId: input.organizationId,
          storefrontId: input.storefrontId,
          resourceId: { not: null },
          lifecycle: { in: ["reserved", "active"] },
          conflictQuarantinedAt: null,
          startsAt: { lt: horizonEnd },
          endsAt: { gt: horizonStart },
        },
        select: {
          id: true,
          resourceId: true,
          startsAt: true,
          endsAt: true,
          lifecycle: true,
          version: true,
          demandRef: true,
          serviceTurn: {
            select: {
              id: true,
              turnId: true,
              stage: true,
              version: true,
              startedAt: true,
              expectedEndAt: true,
              bookingId: true,
            },
          },
        },
        orderBy: { startsAt: "asc" },
        take: 500,
      }),
      client.bookingHold.findMany({
        where: {
          organizationId: input.organizationId,
          storefrontId: input.storefrontId,
          hospitalityResourceId: { not: null },
          expiresAt: { gt: now },
          slotStart: { lt: horizonEnd },
          slotEnd: { gt: horizonStart },
        },
        select: {
          hospitalityResourceId: true,
          slotStart: true,
          slotEnd: true,
        },
        take: 250,
      }),
      client.storefrontBooking.findMany({
        where: {
          organizationId: input.organizationId,
          storefrontId: input.storefrontId,
          status: { in: OPEN_BOOKING_STATUSES },
          OR: [
            { status: "waiting" },
            {
              scheduledAt: {
                gte: horizonStart,
                lt: horizonEnd,
              },
            },
          ],
        },
        select: {
          id: true,
          bookingRef: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          covers: true,
          demandKind: true,
          dietaryNotes: true,
          status: true,
          scheduledAt: true,
          durationMinutes: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
        take: 500,
      }),
      client.staffingResourceLink.findMany({
        where: {
          organizationId: input.organizationId,
          resourceType: "table",
          shift: {
            lifecycle: "published",
            startAt: { lte: now },
            endAt: { gt: now },
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
                select: {
                  id: true,
                  employeeProfileId: true,
                  lifecycle: true,
                },
              },
            },
          },
        },
        take: 500,
      }),
    ]);

  const employeeIds = [
    ...new Set(
      staffingLinks.flatMap((link) =>
        link.shift.assignments
          .map((assignment) => assignment.employeeProfileId)
          .filter((id): id is string => id !== null)
      ),
    ),
  ];
  const employees =
    employeeIds.length > 0
      ? await client.employeeProfile.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, displayName: true },
        })
      : [];
  const employeeName = new Map(
    employees.map((employee) => [employee.id, employee.displayName]),
  );
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const bookingByRef = new Map(
    bookings.map((booking) => [booking.bookingRef, booking]),
  );
  const resourceById = new Map(
    resources.map((resource) => [resource.id, resource]),
  );

  const occupancyGroups = new Map<string, RestaurantOccupancyInput>();
  for (const allocation of allocations) {
    const turn = allocation.serviceTurn;
    if (
      !turn ||
      !turn.bookingId ||
      !allocation.resourceId ||
      !ACTIVE_TURN_STAGES.has(turn.stage)
    ) {
      continue;
    }
    const key = turn.id;
    const existing = occupancyGroups.get(key);
    if (existing) {
      if (!existing.tableIds.includes(allocation.resourceId)) {
        existing.tableIds.push(allocation.resourceId);
      }
      continue;
    }
    occupancyGroups.set(key, {
      tableIds: [allocation.resourceId],
      demandId: turn.bookingId,
      stage: occupancyStage(turn.stage),
      turn: {
        id: turn.id,
        turnId: turn.turnId,
        version: turn.version,
      },
      startedAt: turn.startedAt,
      expectedEndAt: turn.expectedEndAt,
    });
  }

  const sections = new Map<string, RestaurantServerSectionInput>();
  for (const link of staffingLinks) {
    const assignment = link.shift.assignments[0];
    if (!assignment) continue;
    const resource = resourceById.get(link.resourceRef);
    const existing = sections.get(assignment.id);
    if (existing) {
      if (!existing.tableIds.includes(link.resourceRef)) {
        existing.tableIds.push(link.resourceRef);
      }
      continue;
    }
    sections.set(assignment.id, {
      serverId: assignment.id,
      serverName:
        (assignment.employeeProfileId
          ? employeeName.get(assignment.employeeProfileId)
          : null) ?? "Assigned server",
      sectionLabel: resource?.serviceArea?.trim() || "Assigned section",
      tableIds: [link.resourceRef],
    });
  }

  const floor = deriveRestaurantFloor({
    now,
    tables: resources,
    occupancies: [...occupancyGroups.values()],
    holds: holds.flatMap((hold) =>
      hold.hospitalityResourceId
        ? [{
            tableId: hold.hospitalityResourceId,
            startsAt: hold.slotStart,
            endsAt: hold.slotEnd,
          }]
        : []
    ),
    demands: bookings.map((booking) => ({
      id: booking.id,
      kind: booking.demandKind === "walk-in" ? "walk-in" : "reservation",
      guestName: booking.customerName,
      guestEmail: booking.customerEmail,
      guestPhone: booking.customerPhone,
      covers: booking.covers ?? 0,
      status: booking.status,
      arrivedAt:
        booking.demandKind === "walk-in" ? booking.createdAt : null,
      scheduledAt: booking.scheduledAt,
      dietaryNotes: booking.dietaryNotes,
      vip: false,
    })),
    serverSections: [...sections.values()],
    upcoming: allocations.flatMap((allocation) =>
      allocation.resourceId &&
        allocation.serviceTurn === null &&
        allocation.lifecycle === "reserved"
        ? [{
            tableId: allocation.resourceId,
            demandId:
              bookingByRef.get(allocation.demandRef)?.id ??
              allocation.demandRef,
            startsAt: allocation.startsAt,
            endsAt: allocation.endsAt,
          }]
        : []
    ),
  });

  const commands = floor.demand.map((party) => {
    const demand = bookingById.get(party.id)!;
    const candidateResourceIds = [
      ...(party.recommendation?.tableIds.length
        ? [party.recommendation.tableIds]
        : []),
      ...party.compatibleTableIds.flatMap((resourceId) => {
        const resource = resourceById.get(resourceId);
        return resource && resource.capacity >= party.covers
          ? [[resourceId]]
          : [];
      }),
    ];
    const seenCandidates = new Set<string>();
    const options = candidateResourceIds.flatMap((resourceIds) => {
      const key = [...resourceIds].sort().join(",");
      if (seenCandidates.has(key)) return [];
      seenCandidates.add(key);
      const optionResources = resourceIds.flatMap((resourceId) => {
        const resource = resourceById.get(resourceId);
        const floorTable = floor.tables.find((table) => table.id === resourceId);
        return resource && floorTable?.state === "available" ? [resource] : [];
      });
      if (optionResources.length !== resourceIds.length) return [];
      const resourceAllocations = allocations.filter(
        (allocation) =>
          allocation.resourceId !== null &&
          resourceIds.includes(allocation.resourceId),
      );
      return [{
        resourceIds,
        label: optionResources.map((resource) => resource.label).join(" + "),
        interval: {
          startsAt: now.toISOString(),
          endsAt: new Date(
            now.getTime() + demand.durationMinutes * 60_000,
          ).toISOString(),
        },
        expectedVersion: restaurantSeatingVersion({
          demand,
          resources: optionResources,
          allocations: resourceAllocations,
        }),
      }];
    });
    return { demandId: party.id, options };
  });

  const moveTurns = new Map<
    string,
    {
      demandId: string;
      serviceTurnId: string;
      expectedTurnVersion: number;
      expectedEndAt: Date;
      currentResourceIds: string[];
    }
  >();
  for (const allocation of allocations) {
    if (
      !allocation.resourceId ||
      !allocation.serviceTurn ||
      !allocation.serviceTurn.bookingId ||
      !["seated", "ordered"].includes(allocation.serviceTurn.stage)
    ) {
      continue;
    }
    const turnId = allocation.serviceTurn.id;
    const existing = moveTurns.get(turnId);
    if (existing) {
      if (!existing.currentResourceIds.includes(allocation.resourceId)) {
        existing.currentResourceIds.push(allocation.resourceId);
      }
      continue;
    }
    moveTurns.set(turnId, {
      demandId: allocation.serviceTurn.bookingId,
      serviceTurnId: turnId,
      expectedTurnVersion: allocation.serviceTurn.version,
      expectedEndAt: allocation.serviceTurn.expectedEndAt,
      currentResourceIds: [allocation.resourceId],
    });
  }
  const moves = [...moveTurns.values()].flatMap((turn) => {
    const demand = bookingById.get(turn.demandId);
    if (!demand?.covers) return [];
    const targetResources = resources.filter(
      (resource) => !turn.currentResourceIds.includes(resource.id),
    );
    const targetResourceIds = new Set(
      targetResources.map((resource) => resource.id),
    );
    const targetAllocations = allocations.filter(
      (allocation) =>
        allocation.resourceId !== null &&
        targetResourceIds.has(allocation.resourceId),
    );
    const endsAt =
      turn.expectedEndAt.getTime() > now.getTime()
        ? turn.expectedEndAt
        : new Date(now.getTime() + 15 * 60_000);
    const alternatives = findRestaurantSeatingAlternatives({
      covers: demand.covers,
      resources: targetResources,
      allocations: targetAllocations,
      startsAt: now,
      endsAt,
      demandRef: demand.bookingRef,
      limit: 3,
    });
    return [{
      demandId: demand.id,
      serviceTurnId: turn.serviceTurnId,
      expectedTurnVersion: turn.expectedTurnVersion,
      options: alternatives.map((alternative) => {
        const optionResources = resources.filter((resource) =>
          alternative.resourceIds.includes(resource.id),
        );
        const optionAllocations = allocations.filter(
          (allocation) =>
            allocation.resourceId !== null &&
            alternative.resourceIds.includes(allocation.resourceId),
        );
        return {
          resourceIds: alternative.resourceIds,
          label: alternative.label,
          expectedVersion: restaurantSeatingVersion({
            demand,
            resources: optionResources,
            allocations: optionAllocations,
          }),
          interval: {
            startsAt: now.toISOString(),
            endsAt: endsAt.toISOString(),
          },
        };
      }),
    }];
  });

  return attachExactPayloadBytes({
    floor,
    commands,
    moves,
    telemetry: {
      durationMs: Math.max(0, clock() - startedAt),
      queryCount,
      payloadBytes: 0,
    },
  });
}

/**
 * Public boundary for the restaurant's live physical-capacity picture.
 * The operational loader may join customer and staffing facts, but only the
 * explicit customer projection can leave this server-only boundary.
 */
export async function loadPublicRestaurantAvailabilityBySlug(
  database: PublicRestaurantAvailabilityDatabase,
  input: { slug: string; now?: Date },
): Promise<CustomerRestaurantAvailability | null> {
  const storefront = await database.storefrontConfig.findFirst({
    where: {
      isPublished: true,
      organization: { slug: input.slug },
    },
    select: {
      id: true,
      organizationId: true,
      archetype: { select: { archetypeId: true } },
    },
  });
  if (storefront?.archetype?.archetypeId !== "restaurant") return null;

  const view = await loadRestaurantFloorOperationalView(database, {
    organizationId: storefront.organizationId,
    storefrontId: storefront.id,
    ...(input.now ? { now: input.now } : {}),
  });
  return projectCustomerRestaurantAvailability(view.floor);
}

/**
 * The physical snapshot is additive guidance, not a prerequisite for booking.
 * Degrade to the existing slot flow if its live projection is unavailable.
 */
export async function loadPublicRestaurantAvailabilityBySlugSafe(
  database: PublicRestaurantAvailabilityDatabase,
  input: { slug: string; now?: Date },
): Promise<CustomerRestaurantAvailability | null> {
  try {
    return await loadPublicRestaurantAvailabilityBySlug(database, input);
  } catch {
    return null;
  }
}
