/**
 * Veterinary coordination (BI-97290291).
 *
 * A partner practice is a Supplier (arrangement, contact, and later the bills
 * that make cost-per-animal honest) paired with an organization-scoped
 * CareLocation the appointment points at. A veterinary visit is a
 * CareAppointment with an animal subject on the same substrate patients use:
 * visit type, location, preparation and recovery footprint, status events.
 * The recovery footprint is what the placement-readiness evaluator already
 * reads, so a surgery holds the animal back until recovery has elapsed.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";

import { newId } from "@/lib/shared/new-id";

import { ANIMAL_SUBJECT_KIND } from "./intake-policy";
import { recordAnimalCareEvidence, type IntakeClient } from "./intake-repository";
import { VET_VISIT_DEFAULTS, VET_VISIT_KINDS, type VetVisitKind, type VeterinaryWorkspace } from "./veterinary-vocabulary";

export const PARTNER_PRACTICE_LOCATION_KIND = "partner-practice";
export const VET_PRACTICE_CODE_PREFIX = "vet-practice-";

export class VeterinaryCommandError extends Error {
  constructor(
    public readonly code: "invalid_input" | "animal_not_found" | "practice_not_found" | "appointment_not_found" | "illegal_transition" | "stale_version",
    message: string,
  ) {
    super(message);
    this.name = "VeterinaryCommandError";
  }
}

export interface VetActor {
  userId: string;
  principalRef: string;
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

async function setAnimalContext(organizationId: string) {
  await prisma.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true), set_config('app.patient_profile_ids', '', true)`;
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

// ─── Partner practices ──────────────────────────────────────────────────────

export async function registerPartnerPractice(input: {
  organizationId: string;
  timeZone: string;
  actor: VetActor;
  command: { name: string; contactName?: string | null; phone?: string | null; email?: string | null; arrangement?: string | null; address?: string | null };
}): Promise<{ locationId: string; supplierId: string }> {
  const { command } = input;
  if (!text(command.name)) throw new VeterinaryCommandError("invalid_input", "The practice needs a name.");
  const name = command.name.trim();
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        supplierId: `SUP-${newId(10).toUpperCase()}`,
        name,
        contactName: command.contactName?.trim() || null,
        email: command.email?.trim() || null,
        phone: command.phone?.trim() || null,
        address: command.address?.trim() ? { line1: command.address.trim() } : undefined,
        notes: command.arrangement?.trim() ? `Veterinary arrangement: ${command.arrangement.trim()}` : "Veterinary partner practice",
        status: "active",
      },
      select: { id: true, supplierId: true },
    });
    const code = `${VET_PRACTICE_CODE_PREFIX}${slug(name)}-${newId(4).toLowerCase()}`;
    const location = await tx.careLocation.create({
      data: {
        locationId: `LOC-${newId(10).toUpperCase()}`,
        organizationId: input.organizationId,
        code,
        name,
        timezone: input.timeZone,
        address: { kind: PARTNER_PRACTICE_LOCATION_KIND, supplierId: supplier.id, contactName: command.contactName?.trim() || null, phone: command.phone?.trim() || null, arrangement: command.arrangement?.trim() || null, line1: command.address?.trim() || null },
        isActive: true,
      },
      select: { id: true },
    });
    return { locationId: location.id, supplierId: supplier.supplierId };
  });
}

// ─── Appointments ───────────────────────────────────────────────────────────

async function ensureVisitType(tx: Pick<typeof prisma, "careVisitType">, organizationId: string, kind: VetVisitKind) {
  const defaults = VET_VISIT_DEFAULTS[kind];
  const existing = await tx.careVisitType.findFirst({ where: { organizationId, code: defaults.code }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.careVisitType.create({
    data: { visitTypeId: `VT-${newId(10).toUpperCase()}`, organizationId, code: defaults.code, name: defaults.label, defaultDurationMinutes: defaults.durationMinutes, recoveryMinutes: defaults.recoveryMinutes, mode: "in-person", isActive: true },
    select: { id: true },
  });
  return created.id;
}

export async function scheduleAnimalAppointment(input: {
  organizationId: string;
  actor: VetActor;
  command: { animalProfileId: string; kind: VetVisitKind; locationId?: string | null; scheduledStart: string; durationMinutes?: number | null; recoveryMinutes?: number | null; note?: string | null };
  now?: Date;
}): Promise<{ appointmentId: string; footprintEnd: string }> {
  const now = input.now ?? new Date();
  const { command } = input;
  if (!VET_VISIT_KINDS.includes(command.kind)) throw new VeterinaryCommandError("invalid_input", "Choose the kind of visit.");
  const start = new Date(command.scheduledStart);
  if (Number.isNaN(start.getTime())) throw new VeterinaryCommandError("invalid_input", "The visit needs a date and time.");
  const defaults = VET_VISIT_DEFAULTS[command.kind];
  const duration = command.durationMinutes ?? defaults.durationMinutes;
  const recovery = command.recoveryMinutes ?? defaults.recoveryMinutes;
  if (!Number.isInteger(duration) || duration < 5 || duration > 24 * 60) throw new VeterinaryCommandError("invalid_input", "Duration is between 5 minutes and a day.");
  if (!Number.isInteger(recovery) || recovery < 0 || recovery > 60 * 24 * 60) throw new VeterinaryCommandError("invalid_input", "Recovery is between none and sixty days.");
  const end = new Date(start.getTime() + duration * 60_000);
  const footprintEnd = new Date(end.getTime() + recovery * 60_000);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${input.organizationId}, true), set_config('app.patient_profile_ids', '', true)`;
    const animal = await tx.animalProfile.findFirst({ where: { id: command.animalProfileId, organizationId: input.organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } }, select: { id: true, name: true } });
    if (!animal) throw new VeterinaryCommandError("animal_not_found", "That animal is not in this organization's care.");
    if (command.locationId) {
      const location = await tx.careLocation.findFirst({ where: { id: command.locationId, organizationId: input.organizationId, isActive: true }, select: { id: true } });
      if (!location) throw new VeterinaryCommandError("practice_not_found", "That practice is not registered for this organization.");
    }
    const visitTypeId = await ensureVisitType(tx as never, input.organizationId, command.kind);
    const appointment = await tx.careAppointment.create({
      data: {
        appointmentId: `APPT-${newId(10).toUpperCase()}`,
        organizationId: input.organizationId,
        subjectKindSlug: ANIMAL_SUBJECT_KIND,
        subjectRef: `${ANIMAL_SUBJECT_KIND}:${animal.id}`,
        visitTypeId,
        locationId: command.locationId ?? null,
        status: "booked",
        scheduledStart: start,
        scheduledEnd: end,
        preparationMinutes: 0,
        recoveryMinutes: recovery,
        footprintStart: start,
        footprintEnd,
        encounterRef: command.note?.trim() || null,
        createdByPrincipalId: input.actor.principalRef,
      },
      select: { id: true },
    });
    await tx.careAppointmentStatusEvent.create({
      data: { eventId: `care-appointment-event-${randomUUID()}`, organizationId: input.organizationId, appointmentId: appointment.id, appointmentVersion: 1, fromStatus: null, toStatus: "booked", reason: `${defaults.label} for ${animal.name}`, actorPrincipalId: input.actor.principalRef, occurredAt: now },
    });
    return { appointmentId: appointment.id, footprintEnd: footprintEnd.toISOString() };
  }, { isolationLevel: "Serializable" });
}

/**
 * Close a visit as done or cancelled. A done sterilization can carry its
 * procedure outcome straight into the intake checklist as typed evidence, so
 * the readiness evaluator sees both the record and the recovery footprint.
 */
export async function closeAnimalAppointment(input: {
  organizationId: string;
  actor: VetActor;
  command: { appointmentId: string; expectedVersion: number; outcome: "fulfilled" | "cancelled" | "no-show"; reason?: string | null; procedure?: { requirementKey: "sterilization" | "vaccination"; provider: string; outcome?: string | null; product?: string | null; complication?: string | null } | null };
  now?: Date;
}): Promise<{ appointmentId: string; version: number; careRecordId: string | null }> {
  const now = input.now ?? new Date();
  const { command } = input;
  if ((command.outcome === "cancelled" || command.outcome === "no-show") && !text(command.reason)) {
    throw new VeterinaryCommandError("invalid_input", "Say why the visit did not happen.");
  }
  const closed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${input.organizationId}, true), set_config('app.patient_profile_ids', '', true)`;
    const appointment = await tx.careAppointment.findFirst({ where: { id: command.appointmentId, organizationId: input.organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND }, select: { id: true, status: true, version: true, subjectRef: true, footprintEnd: true, recoveryMinutes: true } });
    if (!appointment) throw new VeterinaryCommandError("appointment_not_found", "That visit is not on this organization's list.");
    if (appointment.version !== command.expectedVersion) throw new VeterinaryCommandError("stale_version", "This visit changed while you were looking. Reload and try again.");
    if (!["pending", "booked", "arrived"].includes(appointment.status)) throw new VeterinaryCommandError("illegal_transition", `A ${appointment.status} visit cannot be closed again.`);
    const version = appointment.version + 1;
    await tx.careAppointment.update({
      where: { id: appointment.id },
      data: { status: command.outcome, version, ...(command.outcome !== "fulfilled" ? { cancellationReason: command.reason?.trim() ?? null, cancelledAt: now, footprintEnd: now } : {}) },
      select: { id: true },
    });
    await tx.careAppointmentStatusEvent.create({
      data: { eventId: `care-appointment-event-${randomUUID()}`, organizationId: input.organizationId, appointmentId: appointment.id, appointmentVersion: version, fromStatus: appointment.status, toStatus: command.outcome, reason: command.reason?.trim() || null, actorPrincipalId: input.actor.principalRef, occurredAt: now },
    });
    return { id: appointment.id, version, subjectRef: appointment.subjectRef, footprintEnd: appointment.footprintEnd };
  }, { isolationLevel: "Serializable" });

  let careRecordId: string | null = null;
  if (command.outcome === "fulfilled" && command.procedure) {
    const animalProfileId = closed.subjectRef.slice(ANIMAL_SUBJECT_KIND.length + 1);
    const p = command.procedure;
    const detail = p.requirementKey === "sterilization"
      ? { provider: p.provider, outcome: p.complication ? "complication" : (p.outcome ?? "completed"), recoveryUntil: closed.footprintEnd.toISOString(), complication: p.complication ?? null }
      : { provider: p.provider, product: p.product ?? "", nextDueAt: null };
    const record = await recordAnimalCareEvidence({
      db: prisma as unknown as IntakeClient,
      context: { organizationId: input.organizationId, actorPrincipalId: input.actor.principalRef, now },
      command: { animalProfileId, requirementKey: p.requirementKey, kind: p.requirementKey === "sterilization" ? "procedure" : "vaccination", detail },
    });
    careRecordId = record.careRecordId;
  }
  return { appointmentId: closed.id, version: closed.version, careRecordId };
}

// ─── Board projection ───────────────────────────────────────────────────────

export const VET_BOARD_LIMIT = 50;

export async function loadVeterinaryWorkspace(input: { organizationId: string; now?: Date }): Promise<VeterinaryWorkspace> {
  const now = input.now ?? new Date();
  const { organizationId } = input;
  await setAnimalContext(organizationId);
  const [appointments, locations, animals] = await Promise.all([
    prisma.careAppointment.findMany({
      where: { organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, enteredInErrorAt: null, OR: [{ status: { in: ["pending", "booked", "arrived"] } }, { status: "fulfilled", footprintEnd: { gt: now } }] },
      orderBy: [{ scheduledStart: "asc" }],
      take: VET_BOARD_LIMIT,
      select: { id: true, version: true, status: true, subjectRef: true, scheduledStart: true, scheduledEnd: true, footprintEnd: true, recoveryMinutes: true, encounterRef: true, visitType: { select: { code: true, name: true } }, location: { select: { name: true } } },
    }),
    prisma.careLocation.findMany({ where: { organizationId, isActive: true, code: { startsWith: VET_PRACTICE_CODE_PREFIX } }, orderBy: { name: "asc" }, take: 50, select: { id: true, name: true, address: true } }),
    prisma.animalProfile.findMany({ where: { organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } }, orderBy: [{ name: "asc" }], take: 200, select: { id: true, name: true, animalRef: true } }),
  ]);
  const byId = new Map(animals.map((a) => [a.id, a]));
  const kindByCode = new Map(Object.entries(VET_VISIT_DEFAULTS).map(([kind, d]) => [d.code, kind as VetVisitKind]));
  return {
    appointments: appointments.map((a) => {
      const animalProfileId = a.subjectRef.slice(ANIMAL_SUBJECT_KIND.length + 1);
      const animal = byId.get(animalProfileId);
      const kind = a.visitType ? kindByCode.get(a.visitType.code) ?? null : null;
      return {
        appointmentId: a.id,
        version: a.version,
        status: a.status,
        kind,
        kindLabel: a.visitType?.name ?? "Visit",
        animalProfileId,
        animalName: animal?.name ?? "Unknown animal",
        animalRef: animal?.animalRef ?? "",
        practiceName: a.location?.name ?? null,
        scheduledStart: a.scheduledStart.toISOString(),
        scheduledEnd: a.scheduledEnd.toISOString(),
        recoveryUntil: a.recoveryMinutes > 0 ? a.footprintEnd.toISOString() : null,
        inRecovery: a.status === "fulfilled" && a.footprintEnd.getTime() > now.getTime(),
        note: a.encounterRef,
      };
    }),
    practices: locations.map((l) => {
      const meta = (l.address ?? {}) as { supplierId?: string; contactName?: string | null; phone?: string | null; arrangement?: string | null };
      return { locationId: l.id, supplierId: meta.supplierId ?? null, name: l.name, contactName: meta.contactName ?? null, phone: meta.phone ?? null, arrangement: meta.arrangement ?? null };
    }),
    animals: animals.map((a) => ({ animalProfileId: a.id, name: a.name, animalRef: a.animalRef })),
    limit: VET_BOARD_LIMIT,
  };
}
