import { randomUUID } from "node:crypto";

import { prisma, type Prisma } from "@dpf/db";
import {
  assertAppointmentTransition,
  calculateAppointmentFootprint,
  validateCareAppointmentAcceptance,
  type CareAppointmentStatus,
  type ControlledOverbooking,
} from "@dpf/db/healthcare-care-appointment";
import { patientSubjectReference } from "@dpf/db/subject-reference";
import { isExclusionViolation } from "@/lib/db/exclusion-violation";

export type AcceptCareAppointmentRequest = {
  organizationId: string;
  storefrontBookingId: string;
  patientProfileId: string;
  patientPrincipalId: string;
  visitTypeId: string;
  locationId: string;
  providerIds: string[];
  resourceIds: string[];
  scheduledStart: Date;
  durationMinutes: number;
  preparationMinutes: number;
  recoveryMinutes: number;
  recurrenceScheduleId: string | null;
  recallAt: Date | null;
  rescheduledFromAppointmentId: string | null;
  overbooking: ControlledOverbooking | null;
  actorPrincipalId: string;
  actorType: "human" | "agent" | "service";
  actorRef: string;
  sourceChannel: string;
  sourceVersion?: string | null;
  correlationId: string;
};

type AppointmentRecord = {
  id: string;
  appointmentId: string;
  version: number;
};

type CareAppointmentTransaction = {
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  storefrontBooking: {
    findFirst(args: unknown): Promise<{ id: string; organizationId: string } | null>;
  };
  patientProfile: {
    findFirst(args: unknown): Promise<{ id: string; organizationId: string } | null>;
  };
  careVisitType: {
    findFirst(args: unknown): Promise<
      { id: string; organizationId: string; isActive: boolean } | null
    >;
  };
  careLocation: {
    findFirst(args: unknown): Promise<
      { id: string; organizationId: string; isActive: boolean } | null
    >;
  };
  serviceProvider: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
  careResource: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
  careSchedulingPolicy: {
    findFirst(args: unknown): Promise<{
      allowControlledOverbooking: boolean;
      requiresHumanApproval: boolean;
      maxConcurrentAppointments: number;
    } | null>;
  };
  careAppointment: {
    findFirst(args: unknown): Promise<AppointmentRecord | null>;
    create(args: unknown): Promise<AppointmentRecord>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  careAppointmentParticipant: {
    updateMany(args: unknown): Promise<{ count: number }>;
    count(args: unknown): Promise<number>;
  };
  careAppointmentResource: {
    updateMany(args: unknown): Promise<{ count: number }>;
    count(args: unknown): Promise<number>;
  };
  careAppointmentStatusEvent: {
    create(args: unknown): Promise<unknown>;
  };
  appointmentSyncEvent: {
    create(args: unknown): Promise<unknown>;
  };
};

export type CareAppointmentDatabase = {
  $transaction<T>(
    callback: (transaction: CareAppointmentTransaction) => Promise<T>,
  ): Promise<T>;
};

export type AcceptCareAppointmentResult =
  | {
      ok: true;
      outcome: "created" | "duplicate";
      appointmentId: string;
      version: number;
    }
  | {
      ok: false;
      outcome: "rejected" | "collision";
      errors: string[];
    };

function present(value: string): boolean {
  return value.trim().length > 0 && !value.includes(",");
}

function requestValidationErrors(
  request: AcceptCareAppointmentRequest,
): string[] {
  const validation = validateCareAppointmentAcceptance({
    organizationId: request.organizationId,
    storefrontBookingId: request.storefrontBookingId,
    patientProfileId: request.patientProfileId,
    visitTypeId: request.visitTypeId,
    locationId: request.locationId,
    scheduledStart: request.scheduledStart,
    durationMinutes: request.durationMinutes,
    preparationMinutes: request.preparationMinutes,
    recoveryMinutes: request.recoveryMinutes,
    participantProviderIds: request.providerIds,
    resourceIds: request.resourceIds,
    overbooking: request.overbooking,
  });
  const errors = validation.ok ? [] : [...validation.errors];
  if (!present(request.patientPrincipalId)) {
    errors.push("patient-principal-required");
  }
  if (!present(request.actorPrincipalId)) errors.push("actor-required");
  if (!present(request.actorRef)) errors.push("actor-ref-required");
  if (!present(request.sourceChannel)) errors.push("source-channel-required");
  if (!present(request.correlationId)) errors.push("correlation-id-required");
  return errors;
}

function rejected(errors: string[]): AcceptCareAppointmentResult {
  return { ok: false, outcome: "rejected", errors };
}

export async function acceptStorefrontBookingAsCareAppointment(
  request: AcceptCareAppointmentRequest,
  database: CareAppointmentDatabase =
    prisma as unknown as CareAppointmentDatabase,
): Promise<AcceptCareAppointmentResult> {
  const errors = requestValidationErrors(request);
  if (errors.length > 0) return rejected(errors);

  try {
    return await database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT
          set_config('app.organization_id', ${request.organizationId}, true),
          set_config(
            'app.patient_principal_ids',
            ${request.patientPrincipalId},
            true
          )
      `;

      const existing = await transaction.careAppointment.findFirst({
        where: {
          organizationId: request.organizationId,
          storefrontBookingId: request.storefrontBookingId,
        },
        select: { id: true, appointmentId: true, version: true },
      });
      if (existing !== null) {
        return {
          ok: true,
          outcome: "duplicate",
          appointmentId: existing.appointmentId,
          version: existing.version,
        };
      }

      let rescheduledFromId: string | null = null;
      if (request.rescheduledFromAppointmentId !== null) {
        const prior = await transaction.careAppointment.findFirst({
          where: {
            appointmentId: request.rescheduledFromAppointmentId,
            organizationId: request.organizationId,
            patientProfileId: request.patientProfileId,
          },
          select: { id: true, appointmentId: true, version: true },
        });
        if (prior === null) {
          return rejected(["rescheduled-appointment-unavailable"]);
        }
        rescheduledFromId = prior.id;
      }

      const [booking, patient, visitType, location, providers, resources] =
        await Promise.all([
          transaction.storefrontBooking.findFirst({
            where: {
              id: request.storefrontBookingId,
              organizationId: request.organizationId,
            },
            select: { id: true, organizationId: true },
          }),
          transaction.patientProfile.findFirst({
            where: {
              id: request.patientProfileId,
              organizationId: request.organizationId,
              principalId: request.patientPrincipalId,
              status: "active",
            },
            select: { id: true, organizationId: true },
          }),
          transaction.careVisitType.findFirst({
            where: {
              id: request.visitTypeId,
              organizationId: request.organizationId,
              isActive: true,
            },
            select: { id: true, organizationId: true, isActive: true },
          }),
          transaction.careLocation.findFirst({
            where: {
              id: request.locationId,
              organizationId: request.organizationId,
              isActive: true,
            },
            select: { id: true, organizationId: true, isActive: true },
          }),
          transaction.serviceProvider.findMany({
            where: {
              id: { in: request.providerIds },
              isActive: true,
              storefront: { organizationId: request.organizationId },
            },
            select: { id: true },
          }),
          transaction.careResource.findMany({
            where: {
              id: { in: request.resourceIds },
              organizationId: request.organizationId,
              locationId: request.locationId,
              isActive: true,
            },
            select: { id: true },
          }),
        ]);

      const substrateErrors: string[] = [];
      if (booking === null) substrateErrors.push("storefront-booking-unavailable");
      if (patient === null) substrateErrors.push("patient-unavailable");
      if (visitType === null) substrateErrors.push("visit-type-unavailable");
      if (location === null) substrateErrors.push("location-unavailable");
      if (providers.length !== request.providerIds.length) {
        substrateErrors.push("provider-unavailable");
      }
      if (resources.length !== request.resourceIds.length) {
        substrateErrors.push("resource-unavailable");
      }
      if (substrateErrors.length > 0) return rejected(substrateErrors);

      const footprint = calculateAppointmentFootprint(request);
      const allocationLockKeys = [
        ...request.providerIds.map(
          (providerId) =>
            `${request.organizationId}:care-provider:${providerId}`,
        ),
        ...request.resourceIds.map(
          (resourceId) =>
            `${request.organizationId}:care-resource:${resourceId}`,
        ),
      ].sort();
      for (const lockKey of allocationLockKeys) {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
      }

      if (request.overbooking !== null) {
        const at = new Date();
        const policy = await transaction.careSchedulingPolicy.findFirst({
          where: {
            organizationId: request.organizationId,
            isActive: true,
            allowControlledOverbooking: true,
            effectiveFrom: { lte: at },
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
            AND: [
              {
                OR: [
                  { locationId: request.locationId },
                  { locationId: null },
                ],
              },
            ],
          },
          orderBy: { locationId: "desc" },
          select: {
            allowControlledOverbooking: true,
            requiresHumanApproval: true,
            maxConcurrentAppointments: true,
          },
        });
        if (
          policy === null
          || !policy.allowControlledOverbooking
          || (policy.requiresHumanApproval && request.actorType !== "human")
        ) {
          return rejected(["controlled-overbooking-not-permitted"]);
        }
        const concurrentCounts = await Promise.all([
          ...request.providerIds.map((providerId) =>
            transaction.careAppointmentParticipant.count({
              where: {
                organizationId: request.organizationId,
                providerId,
                allocationState: "active",
                footprintStart: { lt: footprint.footprintEnd },
                footprintEnd: { gt: footprint.footprintStart },
              },
            }),
          ),
          ...request.resourceIds.map((resourceId) =>
            transaction.careAppointmentResource.count({
              where: {
                organizationId: request.organizationId,
                resourceId,
                allocationState: "active",
                footprintStart: { lt: footprint.footprintEnd },
                footprintEnd: { gt: footprint.footprintStart },
              },
            }),
          ),
        ]);
        if (
          concurrentCounts.some(
            (count) => count >= policy.maxConcurrentAppointments,
          )
        ) {
          return rejected(["controlled-overbooking-capacity-exceeded"]);
        }
      }

      const appointmentId = `care-appointment-${randomUUID()}`;
      const isOverbooked = request.overbooking !== null;
      const created = await transaction.careAppointment.create({
        data: {
          appointmentId,
          organizationId: request.organizationId,
          storefrontBookingId: request.storefrontBookingId,
          patientProfileId: request.patientProfileId,
          ...patientSubjectReference(request.patientProfileId),
          visitTypeId: request.visitTypeId,
          locationId: request.locationId,
          status: "pending",
          scheduledStart: request.scheduledStart,
          scheduledEnd: footprint.scheduledEnd,
          preparationMinutes: request.preparationMinutes,
          recoveryMinutes: request.recoveryMinutes,
          footprintStart: footprint.footprintStart,
          footprintEnd: footprint.footprintEnd,
          recurrenceScheduleId: request.recurrenceScheduleId,
          recallAt: request.recallAt,
          rescheduledFromAppointmentId: rescheduledFromId,
          overbookAuthorizedByPrincipalId:
            request.overbooking?.authorizedByPrincipalId ?? null,
          overbookReason: request.overbooking?.reason ?? null,
          createdByPrincipalId: request.actorPrincipalId,
          participants: {
            create: request.providerIds.map((providerId, index) => ({
              organizationId: request.organizationId,
              providerId,
              role: index === 0 ? "primary-practitioner" : "practitioner",
              participationStatus: "needs-action",
              footprintStart: footprint.footprintStart,
              footprintEnd: footprint.footprintEnd,
              overbooked: isOverbooked,
            })),
          },
          resources: {
            create: request.resourceIds.map((resourceId) => ({
              organizationId: request.organizationId,
              resourceId,
              footprintStart: footprint.footprintStart,
              footprintEnd: footprint.footprintEnd,
              overbooked: isOverbooked,
            })),
          },
          statusEvents: {
            create: {
              eventId: `care-appointment-event-${randomUUID()}`,
              organizationId: request.organizationId,
              appointmentVersion: 1,
              fromStatus: null,
              toStatus: "pending",
              reason: "storefront-booking-accepted",
              actorPrincipalId: request.actorPrincipalId,
            },
          },
          syncEvents: {
            create: {
              syncEventId: `appointment-sync-${randomUUID()}`,
              organizationId: request.organizationId,
              storefrontBookingId: request.storefrontBookingId,
              correlationId: request.correlationId,
              sourceChannel: request.sourceChannel,
              requestedTransition: "accept",
              sourceVersion: request.sourceVersion ?? null,
              expectedVersion: null,
              resultingVersion: 1,
              outcome: "applied",
              detail: {
                providerCount: request.providerIds.length,
                resourceCount: request.resourceIds.length,
                overbooked: isOverbooked,
              } satisfies Prisma.InputJsonValue,
              actorType: request.actorType,
              actorRef: request.actorRef,
            },
          },
        },
        select: { appointmentId: true, id: true, version: true },
      });

      return {
        ok: true,
        outcome: "created",
        appointmentId: created.appointmentId,
        version: created.version,
      };
    });
  } catch (error) {
    if (isExclusionViolation(error)) {
      return {
        ok: false,
        outcome: "collision",
        errors: ["care-resource-or-practitioner-unavailable"],
      };
    }
    throw error;
  }
}

export type TransitionCareAppointmentRequest = {
  organizationId: string;
  appointmentId: string;
  patientPrincipalId: string;
  expectedVersion: number;
  toStatus: CareAppointmentStatus;
  reason: string | null;
  actorPrincipalId: string;
  actorType: "human" | "agent" | "service";
  actorRef: string;
  sourceChannel: string;
  sourceVersion?: string | null;
  correlationId: string;
};

type TransitionCareAppointmentResult =
  | {
      ok: true;
      outcome: "transitioned";
      appointmentId: string;
      version: number;
      status: CareAppointmentStatus;
    }
  | {
      ok: false;
      outcome: "rejected";
      errors: string[];
    }
  | {
      ok: false;
      outcome: "conflict";
      errors: ["appointment-version-conflict"];
      currentVersion: number;
      currentStatus: CareAppointmentStatus;
    };

type TransitionAppointmentRecord = AppointmentRecord & {
  organizationId: string;
  patientProfileId: string;
  status: CareAppointmentStatus;
};

const RELEASE_ALLOCATION_STATUSES = new Set<CareAppointmentStatus>([
  "fulfilled",
  "no-show",
  "cancelled",
  "entered-in-error",
]);

async function writeTransitionSyncEvent(
  transaction: CareAppointmentTransaction,
  request: TransitionCareAppointmentRequest,
  appointment: TransitionAppointmentRecord,
  input: {
    outcome: "applied" | "conflict";
    resultingVersion: number;
    conflictCode: string | null;
  },
): Promise<void> {
  await transaction.appointmentSyncEvent.create({
    data: {
      syncEventId: `appointment-sync-${randomUUID()}`,
      organizationId: request.organizationId,
      appointmentId: appointment.id,
      correlationId: request.correlationId,
      sourceChannel: request.sourceChannel,
      requestedTransition: request.toStatus,
      sourceVersion: request.sourceVersion ?? null,
      expectedVersion: request.expectedVersion,
      resultingVersion: input.resultingVersion,
      outcome: input.outcome,
      conflictCode: input.conflictCode,
      detail: {
        reason: request.reason,
        priorStatus: appointment.status,
      } satisfies Prisma.InputJsonValue,
      actorType: request.actorType,
      actorRef: request.actorRef,
    },
  });
}

export async function transitionCareAppointment(
  request: TransitionCareAppointmentRequest,
  database: CareAppointmentDatabase =
    prisma as unknown as CareAppointmentDatabase,
): Promise<TransitionCareAppointmentResult> {
  const errors: string[] = [];
  if (!present(request.organizationId)) errors.push("organization-required");
  if (!present(request.appointmentId)) errors.push("appointment-required");
  if (!present(request.patientPrincipalId)) {
    errors.push("patient-principal-required");
  }
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 1) {
    errors.push("expected-version-invalid");
  }
  if (!present(request.actorPrincipalId)) errors.push("actor-required");
  if (!present(request.actorRef)) errors.push("actor-ref-required");
  if (!present(request.sourceChannel)) errors.push("source-channel-required");
  if (!present(request.correlationId)) errors.push("correlation-id-required");
  if (request.toStatus === "cancelled" && !request.reason?.trim()) {
    errors.push("cancellation-reason-required");
  }
  if (errors.length > 0) {
    return { ok: false, outcome: "rejected", errors };
  }

  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT
        set_config('app.organization_id', ${request.organizationId}, true),
        set_config(
          'app.patient_principal_ids',
          ${request.patientPrincipalId},
          true
        )
    `;

    const appointment = (await transaction.careAppointment.findFirst({
      where: {
        appointmentId: request.appointmentId,
        organizationId: request.organizationId,
        patientProfile: { principalId: request.patientPrincipalId },
      },
      select: {
        id: true,
        appointmentId: true,
        organizationId: true,
        patientProfileId: true,
        status: true,
        version: true,
      },
    })) as TransitionAppointmentRecord | null;

    if (appointment === null) {
      return {
        ok: false,
        outcome: "rejected",
        errors: ["appointment-unavailable"],
      };
    }

    if (appointment.version !== request.expectedVersion) {
      await writeTransitionSyncEvent(transaction, request, appointment, {
        outcome: "conflict",
        resultingVersion: appointment.version,
        conflictCode: "appointment-version-conflict",
      });
      return {
        ok: false,
        outcome: "conflict",
        errors: ["appointment-version-conflict"],
        currentVersion: appointment.version,
        currentStatus: appointment.status,
      };
    }

    try {
      assertAppointmentTransition(appointment.status, request.toStatus);
    } catch {
      return {
        ok: false,
        outcome: "rejected",
        errors: ["appointment-transition-invalid"],
      };
    }

    const now = new Date();
    const update = await transaction.careAppointment.updateMany({
      where: {
        id: appointment.id,
        organizationId: request.organizationId,
        version: request.expectedVersion,
        status: appointment.status,
      },
      data: {
        status: request.toStatus,
        version: { increment: 1 },
        cancellationReason:
          request.toStatus === "cancelled" ? request.reason : undefined,
        cancelledAt: request.toStatus === "cancelled" ? now : undefined,
        enteredInErrorAt:
          request.toStatus === "entered-in-error" ? now : undefined,
      },
    });
    if (update.count !== 1) {
      await writeTransitionSyncEvent(transaction, request, appointment, {
        outcome: "conflict",
        resultingVersion: appointment.version,
        conflictCode: "appointment-version-conflict",
      });
      return {
        ok: false,
        outcome: "conflict",
        errors: ["appointment-version-conflict"],
        currentVersion: appointment.version,
        currentStatus: appointment.status,
      };
    }

    const nextVersion = appointment.version + 1;
    if (RELEASE_ALLOCATION_STATUSES.has(request.toStatus)) {
      await Promise.all([
        transaction.careAppointmentParticipant.updateMany({
          where: {
            appointmentId: appointment.id,
            organizationId: request.organizationId,
          },
          data: {
            allocationState:
              request.toStatus === "cancelled" ? "cancelled" : "released",
          },
        }),
        transaction.careAppointmentResource.updateMany({
          where: {
            appointmentId: appointment.id,
            organizationId: request.organizationId,
          },
          data: {
            allocationState:
              request.toStatus === "cancelled" ? "cancelled" : "released",
          },
        }),
      ]);
    }

    await transaction.careAppointmentStatusEvent.create({
      data: {
        eventId: `care-appointment-event-${randomUUID()}`,
        organizationId: request.organizationId,
        appointmentId: appointment.id,
        appointmentVersion: nextVersion,
        fromStatus: appointment.status,
        toStatus: request.toStatus,
        reason: request.reason,
        actorPrincipalId: request.actorPrincipalId,
      },
    });
    await writeTransitionSyncEvent(transaction, request, appointment, {
      outcome: "applied",
      resultingVersion: nextVersion,
      conflictCode: null,
    });

    return {
      ok: true,
      outcome: "transitioned",
      appointmentId: appointment.appointmentId,
      version: nextVersion,
      status: request.toStatus,
    };
  });
}
