export const CARE_APPOINTMENT_STATUSES = [
  "proposed",
  "pending",
  "booked",
  "arrived",
  "fulfilled",
  "no-show",
  "cancelled",
  "entered-in-error",
] as const;

export type CareAppointmentStatus =
  (typeof CARE_APPOINTMENT_STATUSES)[number];

export const CARE_PARTICIPANT_ROLES = [
  "primary-practitioner",
  "practitioner",
  "nurse",
  "dental-hygienist",
  "assistant",
  "observer",
] as const;

export type CareParticipantRole = (typeof CARE_PARTICIPANT_ROLES)[number];

export const CARE_PARTICIPATION_STATUSES = [
  "needs-action",
  "accepted",
  "declined",
  "tentative",
] as const;
export type CareParticipationStatus =
  (typeof CARE_PARTICIPATION_STATUSES)[number];

export const CARE_RESOURCE_TYPES = ["room", "equipment"] as const;
export type CareResourceType = (typeof CARE_RESOURCE_TYPES)[number];

export const APPOINTMENT_SYNC_OUTCOMES = [
  "applied",
  "duplicate",
  "conflict",
  "rejected",
] as const;
export type AppointmentSyncOutcome =
  (typeof APPOINTMENT_SYNC_OUTCOMES)[number];

export type ControlledOverbooking = {
  authorizedByPrincipalId: string;
  reason: string;
};

export type CareAppointmentAcceptance = {
  organizationId: string;
  storefrontBookingId: string;
  patientProfileId: string;
  visitTypeId: string;
  locationId: string;
  scheduledStart: Date;
  durationMinutes: number;
  preparationMinutes: number;
  recoveryMinutes: number;
  participantProviderIds: string[];
  resourceIds: string[];
  overbooking: ControlledOverbooking | null;
};

export type AppointmentFootprintInput = Pick<
  CareAppointmentAcceptance,
  | "scheduledStart"
  | "durationMinutes"
  | "preparationMinutes"
  | "recoveryMinutes"
>;

export function calculateAppointmentFootprint(
  input: AppointmentFootprintInput,
): {
  footprintStart: Date;
  scheduledEnd: Date;
  footprintEnd: Date;
} {
  const minute = 60_000;
  const start = input.scheduledStart.getTime();
  return {
    footprintStart: new Date(start - input.preparationMinutes * minute),
    scheduledEnd: new Date(start + input.durationMinutes * minute),
    footprintEnd: new Date(
      start + (input.durationMinutes + input.recoveryMinutes) * minute,
    ),
  };
}

type AcceptanceValidation =
  | { ok: true; value: CareAppointmentAcceptance }
  | { ok: false; errors: string[] };

function isPresent(value: string): boolean {
  return value.trim().length > 0;
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateCareAppointmentAcceptance(
  input: CareAppointmentAcceptance,
): AcceptanceValidation {
  const errors: string[] = [];

  if (!isPresent(input.organizationId)) errors.push("organization-required");
  if (!isPresent(input.storefrontBookingId)) {
    errors.push("storefront-booking-required");
  }
  if (!isPresent(input.patientProfileId)) errors.push("patient-required");
  if (!isPresent(input.visitTypeId)) errors.push("visit-type-required");
  if (!isPresent(input.locationId)) errors.push("location-required");
  if (
    !(input.scheduledStart instanceof Date)
    || Number.isNaN(input.scheduledStart.getTime())
  ) {
    errors.push("scheduled-start-invalid");
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    errors.push("duration-invalid");
  }
  if (
    !Number.isInteger(input.preparationMinutes)
    || input.preparationMinutes < 0
  ) {
    errors.push("preparation-invalid");
  }
  if (
    !Number.isInteger(input.recoveryMinutes)
    || input.recoveryMinutes < 0
  ) {
    errors.push("recovery-invalid");
  }
  if (input.participantProviderIds.length === 0) {
    errors.push("participant-required");
  }
  if (
    input.participantProviderIds.some((providerId) => !isPresent(providerId))
  ) {
    errors.push("participant-invalid");
  }
  if (hasDuplicates(input.participantProviderIds)) {
    errors.push("participant-duplicate");
  }
  if (input.resourceIds.some((resourceId) => !isPresent(resourceId))) {
    errors.push("resource-invalid");
  }
  if (hasDuplicates(input.resourceIds)) errors.push("resource-duplicate");
  if (
    input.overbooking !== null
    && !isPresent(input.overbooking.authorizedByPrincipalId)
  ) {
    errors.push("overbooking-authorizer-required");
  }
  if (
    input.overbooking !== null
    && !isPresent(input.overbooking.reason)
  ) {
    errors.push("overbooking-reason-required");
  }

  return errors.length === 0 ? { ok: true, value: input } : { ok: false, errors };
}

const TRANSITIONS: Readonly<
  Record<CareAppointmentStatus, readonly CareAppointmentStatus[]>
> = {
  proposed: ["pending", "cancelled", "entered-in-error"],
  pending: ["booked", "cancelled", "entered-in-error"],
  booked: ["arrived", "no-show", "cancelled", "entered-in-error"],
  arrived: ["fulfilled", "cancelled", "entered-in-error"],
  fulfilled: ["entered-in-error"],
  "no-show": ["entered-in-error"],
  cancelled: ["entered-in-error"],
  "entered-in-error": [],
};

export function assertAppointmentTransition(
  from: CareAppointmentStatus,
  to: CareAppointmentStatus,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid care appointment transition: ${from} -> ${to}`);
  }
}
