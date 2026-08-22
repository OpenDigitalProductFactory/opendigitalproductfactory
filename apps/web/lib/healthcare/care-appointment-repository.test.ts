import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptStorefrontBookingAsCareAppointment,
  transitionCareAppointment,
  type AcceptCareAppointmentRequest,
  type CareAppointmentDatabase,
} from "./care-appointment-repository";

const request: AcceptCareAppointmentRequest = {
  organizationId: "org-a",
  storefrontBookingId: "booking-a",
  patientProfileId: "patient-a",
  patientPrincipalId: "patient-principal-a",
  visitTypeId: "visit-type-a",
  locationId: "location-a",
  providerIds: ["provider-a", "provider-b"],
  resourceIds: ["room-a"],
  scheduledStart: new Date("2026-08-01T14:00:00.000Z"),
  durationMinutes: 45,
  preparationMinutes: 10,
  recoveryMinutes: 15,
  recurrenceScheduleId: null,
  recallAt: null,
  rescheduledFromAppointmentId: null,
  overbooking: null,
  actorPrincipalId: "principal-receptionist",
  actorType: "human",
  actorRef: "principal-receptionist",
  sourceChannel: "reception",
  correlationId: "accept-booking-a-v1",
};

function makeDatabase() {
  const transaction = {
    $executeRaw: vi.fn(async () => 1),
    storefrontBooking: {
      findFirst: vi.fn(async () => ({
        id: "booking-a",
        organizationId: "org-a",
      })),
    },
    patientProfile: {
      findFirst: vi.fn(async () => ({
        id: "patient-a",
        organizationId: "org-a",
      })),
    },
    careVisitType: {
      findFirst: vi.fn(async () => ({
        id: "visit-type-a",
        organizationId: "org-a",
        isActive: true,
      })),
    },
    careLocation: {
      findFirst: vi.fn(async () => ({
        id: "location-a",
        organizationId: "org-a",
        isActive: true,
      })),
    },
    serviceProvider: {
      findMany: vi.fn(async () => [
        { id: "provider-a" },
        { id: "provider-b" },
      ]),
    },
    careResource: {
      findMany: vi.fn(async () => [{ id: "room-a" }]),
    },
    careSchedulingPolicy: {
      findFirst: vi.fn(async () => null),
    },
    careAppointment: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({
        id: "appointment-row-a",
        appointmentId: "appointment-a",
        version: 1,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    careAppointmentParticipant: {
      updateMany: vi.fn(async () => ({ count: 2 })),
      count: vi.fn(async () => 0),
    },
    careAppointmentResource: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
    },
    careAppointmentStatusEvent: {
      create: vi.fn(async () => ({})),
    },
    appointmentSyncEvent: {
      create: vi.fn(async () => ({})),
    },
  };
  const database: CareAppointmentDatabase = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  };
  return { database, transaction };
}

describe("care appointment repository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a public booking atomically with patient context and allocations", async () => {
    const { database, transaction } = makeDatabase();

    const result = await acceptStorefrontBookingAsCareAppointment(
      request,
      database,
    );

    expect(result).toEqual({
      ok: true,
      outcome: "created",
      appointmentId: "appointment-a",
      version: 1,
    });
    expect(transaction.$executeRaw).toHaveBeenCalledBefore(
      transaction.storefrontBooking.findFirst,
    );
    expect(transaction.careAppointment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-a",
        storefrontBookingId: "booking-a",
        subjectKindSlug: "patient-profile",
        subjectRef: "patient-a",
        patientProfileId: "patient-a",
        scheduledStart: new Date("2026-08-01T14:00:00.000Z"),
        scheduledEnd: new Date("2026-08-01T14:45:00.000Z"),
        footprintStart: new Date("2026-08-01T13:50:00.000Z"),
        footprintEnd: new Date("2026-08-01T15:00:00.000Z"),
        participants: {
          create: [
            expect.objectContaining({ providerId: "provider-a" }),
            expect.objectContaining({ providerId: "provider-b" }),
          ],
        },
        resources: {
          create: [expect.objectContaining({ resourceId: "room-a" })],
        },
        statusEvents: {
          create: expect.objectContaining({
            appointmentVersion: 1,
            fromStatus: null,
            toStatus: "pending",
          }),
        },
        syncEvents: {
          create: expect.objectContaining({
            correlationId: "accept-booking-a-v1",
            outcome: "applied",
          }),
        },
      }),
      select: { appointmentId: true, id: true, version: true },
    });
  });

  it("returns the existing appointment for an idempotent retry", async () => {
    const { database, transaction } = makeDatabase();
    transaction.careAppointment.findFirst.mockResolvedValueOnce({
      id: "appointment-row-existing",
      appointmentId: "appointment-existing",
      version: 3,
    } as never);

    await expect(
      acceptStorefrontBookingAsCareAppointment(request, database),
    ).resolves.toEqual({
      ok: true,
      outcome: "duplicate",
      appointmentId: "appointment-existing",
      version: 3,
    });
    expect(transaction.careAppointment.create).not.toHaveBeenCalled();
  });

  it("rejects controlled overbooking when no active policy permits it", async () => {
    const { database, transaction } = makeDatabase();

    await expect(
      acceptStorefrontBookingAsCareAppointment(
        {
          ...request,
          overbooking: {
            authorizedByPrincipalId: "principal-clinical-lead",
            reason: "Urgent post-operative review",
          },
        },
        database,
      ),
    ).resolves.toEqual({
      ok: false,
      outcome: "rejected",
      errors: ["controlled-overbooking-not-permitted"],
    });
    expect(transaction.careAppointment.create).not.toHaveBeenCalled();
  });

  it("enforces the policy concurrency ceiling under controlled overbooking", async () => {
    const { database, transaction } = makeDatabase();
    transaction.careSchedulingPolicy.findFirst.mockResolvedValueOnce({
      allowControlledOverbooking: true,
      requiresHumanApproval: true,
      maxConcurrentAppointments: 2,
    } as never);
    transaction.careAppointmentParticipant.count.mockResolvedValueOnce(2);

    await expect(
      acceptStorefrontBookingAsCareAppointment(
        {
          ...request,
          overbooking: {
            authorizedByPrincipalId: "principal-clinical-lead",
            reason: "Urgent post-operative review",
          },
        },
        database,
      ),
    ).resolves.toEqual({
      ok: false,
      outcome: "rejected",
      errors: ["controlled-overbooking-capacity-exceeded"],
    });
    expect(transaction.careAppointment.create).not.toHaveBeenCalled();
  });

  it("maps a database exclusion violation to a visible scheduling collision", async () => {
    const { database, transaction } = makeDatabase();
    const collision = new Error(
      'conflicting key value violates exclusion constraint "CareAppointmentParticipant_no_overlap"',
    ) as Error & { meta?: { code: string } };
    collision.meta = { code: "23P01" };
    transaction.careAppointment.create.mockRejectedValueOnce(collision);

    await expect(
      acceptStorefrontBookingAsCareAppointment(request, database),
    ).resolves.toEqual({
      ok: false,
      outcome: "collision",
      errors: ["care-resource-or-practitioner-unavailable"],
    });
  });

  it("resolves reschedule lineage within the same patient and organization", async () => {
    const { database, transaction } = makeDatabase();
    transaction.careAppointment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "appointment-row-prior",
        appointmentId: "appointment-prior",
        version: 2,
        patientProfileId: "patient-a",
      } as never);

    await acceptStorefrontBookingAsCareAppointment(
      {
        ...request,
        rescheduledFromAppointmentId: "appointment-prior",
      },
      database,
    );

    expect(transaction.careAppointment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rescheduledFromAppointmentId: "appointment-row-prior",
      }),
      select: { appointmentId: true, id: true, version: true },
    });
  });
});

describe("care appointment lifecycle repository", () => {
  it("uses an optimistic version and appends transition evidence", async () => {
    const { database, transaction } = makeDatabase();
    transaction.careAppointment.findFirst.mockResolvedValueOnce({
      id: "appointment-row-a",
      appointmentId: "appointment-a",
      organizationId: "org-a",
      patientProfileId: "patient-a",
      status: "booked",
      version: 4,
    } as never);

    await expect(
      transitionCareAppointment(
        {
          organizationId: "org-a",
          appointmentId: "appointment-a",
          patientPrincipalId: "patient-principal-a",
          expectedVersion: 4,
          toStatus: "arrived",
          reason: "Checked in at reception",
          actorPrincipalId: "principal-receptionist",
          actorType: "human",
          actorRef: "principal-receptionist",
          sourceChannel: "reception",
          correlationId: "appointment-a-arrive-v4",
        },
        database,
      ),
    ).resolves.toEqual({
      ok: true,
      outcome: "transitioned",
      appointmentId: "appointment-a",
      version: 5,
      status: "arrived",
    });

    expect(transaction.careAppointment.updateMany).toHaveBeenCalledWith({
      where: {
        id: "appointment-row-a",
        organizationId: "org-a",
        version: 4,
        status: "booked",
      },
      data: expect.objectContaining({
        status: "arrived",
        version: { increment: 1 },
      }),
    });
    expect(transaction.careAppointmentStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentVersion: 5,
        fromStatus: "booked",
        toStatus: "arrived",
      }),
    });
  });

  it("returns a reconciliation conflict when the version changed", async () => {
    const { database, transaction } = makeDatabase();
    transaction.careAppointment.findFirst.mockResolvedValueOnce({
      id: "appointment-row-a",
      appointmentId: "appointment-a",
      organizationId: "org-a",
      patientProfileId: "patient-a",
      status: "booked",
      version: 5,
    } as never);

    await expect(
      transitionCareAppointment(
        {
          organizationId: "org-a",
          appointmentId: "appointment-a",
          patientPrincipalId: "patient-principal-a",
          expectedVersion: 4,
          toStatus: "arrived",
          reason: null,
          actorPrincipalId: "principal-receptionist",
          actorType: "human",
          actorRef: "principal-receptionist",
          sourceChannel: "reception",
          correlationId: "appointment-a-arrive-stale",
        },
        database,
      ),
    ).resolves.toEqual({
      ok: false,
      outcome: "conflict",
      errors: ["appointment-version-conflict"],
      currentVersion: 5,
      currentStatus: "booked",
    });
    expect(transaction.appointmentSyncEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcome: "conflict",
        conflictCode: "appointment-version-conflict",
      }),
    });
    expect(transaction.careAppointment.updateMany).not.toHaveBeenCalled();
  });

  it("releases practitioner and resource allocations on cancellation", async () => {
    const { database, transaction } = makeDatabase();
    transaction.careAppointment.findFirst.mockResolvedValueOnce({
      id: "appointment-row-a",
      appointmentId: "appointment-a",
      organizationId: "org-a",
      patientProfileId: "patient-a",
      status: "booked",
      version: 2,
    } as never);

    const result = await transitionCareAppointment(
      {
        organizationId: "org-a",
        appointmentId: "appointment-a",
        patientPrincipalId: "patient-principal-a",
        expectedVersion: 2,
        toStatus: "cancelled",
        reason: "Patient requested cancellation",
        actorPrincipalId: "principal-receptionist",
        actorType: "human",
        actorRef: "principal-receptionist",
        sourceChannel: "phone",
        correlationId: "appointment-a-cancel-v2",
      },
      database,
    );

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(transaction.careAppointmentParticipant.updateMany).toHaveBeenCalledWith({
      where: { appointmentId: "appointment-row-a", organizationId: "org-a" },
      data: { allocationState: "cancelled" },
    });
    expect(transaction.careAppointmentResource.updateMany).toHaveBeenCalled();
  });
});
