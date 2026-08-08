import { serializeRestaurantTableAttributes } from "@/lib/storefront/restaurant-table-attributes";

import {
  buildRestaurantDemoFloorPlan,
  type RestaurantDemoBookingInput,
  type RestaurantDemoEmployeeInput,
} from "./restaurant-demo-floor";

export interface RestaurantDemoFloorDatabase {
  hospitalityResource: {
    upsert(args: unknown): Promise<{ id: string }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  storefrontBooking: {
    update(args: unknown): Promise<unknown>;
  };
  staffingShift: {
    upsert(args: unknown): Promise<{ id: string }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  staffingAssignment: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  staffingResourceLink: {
    deleteMany(args: unknown): Promise<{ count: number }>;
    createMany(args: unknown): Promise<{ count: number }>;
  };
  hospitalityServiceTurn: {
    upsert(args: unknown): Promise<{ id: string }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  hospitalityServiceTurnEvent: {
    upsert(args: unknown): Promise<unknown>;
  };
  hospitalityCapacityAllocation: {
    updateMany(args: unknown): Promise<{ count: number }>;
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  operationalSceneLayout: {
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
}

export async function persistRestaurantDemoFloor(input: {
  database: RestaurantDemoFloorDatabase;
  organizationId: string;
  storefrontId: string;
  providerIds: readonly string[];
  bookings: readonly RestaurantDemoBookingInput[];
  employees: readonly RestaurantDemoEmployeeInput[];
  now: Date;
  timezone: string;
}): Promise<void> {
  const plan = buildRestaurantDemoFloorPlan(input);
  const tableIdByKey = new Map<string, string>();
  for (const [index, table] of plan.tables.entries()) {
    const legacyServiceProviderId = input.providerIds[index] ?? null;
    const resource = await input.database.hospitalityResource.upsert({
      where: legacyServiceProviderId
        ? { legacyServiceProviderId }
        : {
            storefrontId_resourceId: {
              storefrontId: input.storefrontId,
              resourceId: table.resourceId,
            },
          },
      create: {
        resourceId: table.resourceId,
        organizationId: input.organizationId,
        storefrontId: input.storefrontId,
        kind: "table",
        label: table.label,
        status: table.status,
        capacity: table.capacity,
        capacityUnit: "seats",
        serviceArea: table.serviceArea,
        blockedReason: table.blockedReason,
        attributes: serializeRestaurantTableAttributes(table.attributes),
        legacyServiceProviderId,
      },
      update: {
        resourceId: table.resourceId,
        label: table.label,
        status: table.status,
        capacity: table.capacity,
        capacityUnit: "seats",
        serviceArea: table.serviceArea,
        blockedReason: table.blockedReason,
        attributes: serializeRestaurantTableAttributes(table.attributes),
      },
      select: { id: true },
    });
    tableIdByKey.set(table.key, resource.id);
  }

  const tableForBooking = new Map<number, string | null>([
    [0, null],
    [1, tableIdByKey.get("table-9") ?? null],
    [2, tableIdByKey.get("table-2") ?? null],
    [3, tableIdByKey.get("table-3") ?? null],
    [4, tableIdByKey.get("table-5") ?? null],
    [5, tableIdByKey.get("table-7") ?? null],
    [6, tableIdByKey.get("table-8") ?? null],
  ]);
  for (const [index, booking] of plan.bookings.entries()) {
    await input.database.storefrontBooking.update({
      where: { id: booking.id },
      data: {
        demandKind: booking.demandKind,
        covers: booking.covers,
        status: booking.status,
        scheduledAt: booking.scheduledAt,
        createdAt: booking.createdAt,
        durationMinutes: booking.durationMinutes,
        dietaryNotes: booking.dietaryNotes,
        hospitalityResourceId: tableForBooking.get(index) ?? null,
      },
    });
  }

  const assignmentIds: string[] = [];
  for (const section of plan.serverSections) {
    const shift = await input.database.staffingShift.upsert({
      where: { shiftId: section.shiftId },
      create: {
        shiftId: section.shiftId,
        organizationId: input.organizationId,
        startAt: section.startAt,
        endAt: section.endAt,
        timezone: section.timezone,
        lifecycle: "published",
        publicationVersion: 1,
      },
      update: {
        startAt: section.startAt,
        endAt: section.endAt,
        timezone: section.timezone,
        lifecycle: "published",
        publicationVersion: { increment: 1 },
        version: { increment: 1 },
      },
      select: { id: true },
    });
    const assignment = await input.database.staffingAssignment.upsert({
      where: { assignmentId: section.assignmentId },
      create: {
        assignmentId: section.assignmentId,
        organizationId: input.organizationId,
        staffingShiftId: shift.id,
        employeeProfileId: section.employeeId,
        lifecycle: "on_site",
        source: "demo",
      },
      update: {
        staffingShiftId: shift.id,
        employeeProfileId: section.employeeId,
        lifecycle: "on_site",
        source: "demo",
        version: { increment: 1 },
      },
      select: { id: true },
    });
    assignmentIds.push(assignment.id);
    await input.database.staffingResourceLink.deleteMany({
      where: { staffingShiftId: shift.id, resourceType: "table" },
    });
    await input.database.staffingResourceLink.createMany({
      data: section.tableKeys.map((tableKey) => ({
        organizationId: input.organizationId,
        staffingShiftId: shift.id,
        resourceType: "table",
        resourceRef: tableIdByKey.get(tableKey)!,
      })),
    });
  }

  const demoBookingIds = plan.bookings.map((booking) => booking.id);
  await input.database.hospitalityCapacityAllocation.updateMany({
    where: {
      organizationId: input.organizationId,
      bookingId: { in: demoBookingIds },
      lifecycle: { in: ["reserved", "active"] },
    },
    data: {
      lifecycle: "released",
      releasedAt: input.now,
      releaseReason: "Restaurant demo state refreshed",
      version: { increment: 1 },
    },
  });

  for (const turn of plan.turns) {
    const serviceTurn = await input.database.hospitalityServiceTurn.upsert({
      where: { turnId: turn.turnId },
      create: {
        turnId: turn.turnId,
        organizationId: input.organizationId,
        storefrontId: input.storefrontId,
        bookingId: turn.bookingId,
        staffingAssignmentId: assignmentIds[turn.serverIndex],
        demandType: "booking",
        demandRef: turn.bookingRef,
        stage: turn.stage,
        startedAt: turn.startedAt,
        expectedEndAt: turn.expectedEndAt,
      },
      update: {
        staffingAssignmentId: assignmentIds[turn.serverIndex],
        stage: turn.stage,
        startedAt: turn.startedAt,
        expectedEndAt: turn.expectedEndAt,
        closedAt: null,
        version: { increment: 1 },
      },
      select: { id: true },
    });
    await input.database.hospitalityServiceTurnEvent.upsert({
      where: { eventId: `${turn.turnId}-seeded` },
      create: {
        eventId: `${turn.turnId}-seeded`,
        organizationId: input.organizationId,
        serviceTurnId: serviceTurn.id,
        idempotencyKey: `${turn.turnId}:seeded`,
        eventType: "stage-transition",
        toStage: turn.stage,
        atVersion: 1,
        actorRef: "demo-loader",
      },
      update: {},
    });
    for (const tableKey of turn.tableKeys) {
      const resourceId = tableIdByKey.get(tableKey)!;
      const allocationId = `${turn.turnId}-${tableKey}`;
      await input.database.hospitalityCapacityAllocation.upsert({
        where: { allocationId },
        create: {
          allocationId,
          organizationId: input.organizationId,
          storefrontId: input.storefrontId,
          resourceId,
          bookingId: turn.bookingId,
          serviceTurnId: serviceTurn.id,
          demandType: "booking",
          demandRef: turn.bookingRef,
          startsAt: turn.startedAt,
          endsAt: turn.expectedEndAt,
          lifecycle: "active",
          idempotencyKey: `${allocationId}:active`,
        },
        update: {
          resourceId,
          serviceTurnId: serviceTurn.id,
          startsAt: turn.startedAt,
          endsAt: turn.expectedEndAt,
          lifecycle: "active",
          releasedAt: null,
          releaseReason: null,
          version: { increment: 1 },
        },
      });
    }
  }

  const reservation = plan.bookings[1]!;
  const reservationTableId = tableIdByKey.get("table-9")!;
  await input.database.hospitalityCapacityAllocation.upsert({
    where: { allocationId: "demo-restaurant-reservation-table-9" },
    create: {
      allocationId: "demo-restaurant-reservation-table-9",
      organizationId: input.organizationId,
      storefrontId: input.storefrontId,
      resourceId: reservationTableId,
      bookingId: reservation.id,
      demandType: "booking",
      demandRef: reservation.bookingRef,
      startsAt: reservation.scheduledAt,
      endsAt: new Date(
        reservation.scheduledAt.getTime() + reservation.durationMinutes * 60_000,
      ),
      lifecycle: "reserved",
      idempotencyKey: "demo-restaurant-reservation-table-9:reserved",
    },
    update: {
      resourceId: reservationTableId,
      startsAt: reservation.scheduledAt,
      endsAt: new Date(
        reservation.scheduledAt.getTime() + reservation.durationMinutes * 60_000,
      ),
      lifecycle: "reserved",
      releasedAt: null,
      releaseReason: null,
      version: { increment: 1 },
    },
  });
}

export async function removeRestaurantDemoFloor(
  database: RestaurantDemoFloorDatabase,
  input: { organizationId?: string; storefrontIds: readonly string[] },
): Promise<void> {
  const orgWhere = input.organizationId
    ? { organizationId: input.organizationId }
    : {};
  await database.hospitalityCapacityAllocation.deleteMany({
    where: {
      ...orgWhere,
      OR: [
        { allocationId: { startsWith: "demo-restaurant-" } },
        { booking: { bookingRef: { startsWith: "demo-restaurant-bk-" } } },
      ],
    },
  });
  await database.hospitalityServiceTurn.deleteMany({
    where: { ...orgWhere, turnId: { startsWith: "demo-restaurant-" } },
  });
  await database.staffingShift.deleteMany({
    where: { ...orgWhere, shiftId: { startsWith: "demo-restaurant-" } },
  });
  if (input.storefrontIds.length > 0) {
    await database.operationalSceneLayout.deleteMany({
      where: {
        ...orgWhere,
        twinTemplate: "FLOOR",
        locationId: { in: [...input.storefrontIds] },
      },
    });
  }
  await database.hospitalityResource.deleteMany({
    where: { ...orgWhere, resourceId: { startsWith: "demo-restaurant-" } },
  });
}
