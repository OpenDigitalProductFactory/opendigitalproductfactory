import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(async () => 0),
    supplier: { create: vi.fn() },
    careLocation: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    careVisitType: { findFirst: vi.fn(), create: vi.fn() },
    careAppointment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    careAppointmentStatusEvent: { create: vi.fn() },
    careIntakePacket: { findFirst: vi.fn() },
    careRecord: { create: vi.fn() },
    animalProfile: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { buildAnimalIntakeRequirementSnapshot } from "./intake-policy";
import { closeAnimalAppointment, loadVeterinaryWorkspace, registerPartnerPractice, scheduleAnimalAppointment } from "./veterinary";

const ORG = "org-1";
const ACTOR = { userId: "user-1", principalRef: "principal-1" };
const NOW = new Date("2026-09-18T08:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (work: unknown) => (work as (tx: typeof prisma) => Promise<unknown>)(prisma) as never);
  vi.mocked(prisma.careAppointmentStatusEvent.create).mockResolvedValue({} as never);
  vi.mocked(prisma.careAppointment.update).mockResolvedValue({ id: "appt-1" } as never);
});

describe("registerPartnerPractice", () => {
  it("creates a supplier for the arrangement and an organization-scoped location that carries it", async () => {
    vi.mocked(prisma.supplier.create).mockResolvedValue({ id: "sup-row", supplierId: "SUP-1" } as never);
    vi.mocked(prisma.careLocation.create).mockResolvedValue({ id: "loc-1" } as never);
    const result = await registerPartnerPractice({ organizationId: ORG, timeZone: "Europe/Amsterdam", actor: ACTOR, command: { name: "Oak & Prairie Vets", contactName: "Dr Julia", phone: "555", arrangement: "Charity rate, monthly account" } });
    expect(result).toEqual({ locationId: "loc-1", supplierId: "SUP-1" });
    expect(prisma.supplier.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: "Oak & Prairie Vets", contactName: "Dr Julia", notes: "Veterinary arrangement: Charity rate, monthly account" }) }));
    const location = (vi.mocked(prisma.careLocation.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(location).toMatchObject({ organizationId: ORG, timezone: "Europe/Amsterdam", address: expect.objectContaining({ kind: "partner-practice", supplierId: "sup-row", arrangement: "Charity rate, monthly account" }) });
    expect(String(location.code)).toMatch(/^vet-practice-oak-prairie-vets-/);
  });

  it("needs a name", async () => {
    await expect(registerPartnerPractice({ organizationId: ORG, timeZone: "UTC", actor: ACTOR, command: { name: " " } })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("scheduleAnimalAppointment", () => {
  it("books a surgery with the visit type's recovery footprint and a status event", async () => {
    vi.mocked(prisma.animalProfile.findFirst).mockResolvedValue({ id: "animal-1", name: "Ranger" } as never);
    vi.mocked(prisma.careLocation.findFirst).mockResolvedValue({ id: "loc-1" } as never);
    vi.mocked(prisma.careVisitType.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.careVisitType.create).mockResolvedValue({ id: "vt-1" } as never);
    vi.mocked(prisma.careAppointment.create).mockResolvedValue({ id: "appt-1" } as never);
    const result = await scheduleAnimalAppointment({ organizationId: ORG, actor: ACTOR, now: NOW, command: { animalProfileId: "animal-1", kind: "sterilization", locationId: "loc-1", scheduledStart: "2026-09-22T09:00:00Z" } });
    expect(result).toEqual({ appointmentId: "appt-1", footprintEnd: "2026-09-29T10:30:00.000Z" });
    const data = (vi.mocked(prisma.careAppointment.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ subjectKindSlug: "animal-profile", subjectRef: "animal-profile:animal-1", visitTypeId: "vt-1", locationId: "loc-1", status: "booked", recoveryMinutes: 7 * 24 * 60, scheduledEnd: new Date("2026-09-22T10:30:00Z"), footprintEnd: new Date("2026-09-29T10:30:00Z") });
    expect(data.patientProfileId).toBeUndefined();
    expect(prisma.careVisitType.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ code: "vet-sterilization", organizationId: ORG }) }));
    expect(prisma.careAppointmentStatusEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ toStatus: "booked", appointmentVersion: 1 }) }));
  });

  it("refuses an unknown animal, an unregistered practice, and a bad time", async () => {
    vi.mocked(prisma.animalProfile.findFirst).mockResolvedValue(null);
    await expect(scheduleAnimalAppointment({ organizationId: ORG, actor: ACTOR, command: { animalProfileId: "x", kind: "checkup", scheduledStart: "2026-09-22T09:00:00Z" } })).rejects.toMatchObject({ code: "animal_not_found" });
    vi.mocked(prisma.animalProfile.findFirst).mockResolvedValue({ id: "animal-1", name: "Ranger" } as never);
    vi.mocked(prisma.careLocation.findFirst).mockResolvedValue(null);
    await expect(scheduleAnimalAppointment({ organizationId: ORG, actor: ACTOR, command: { animalProfileId: "animal-1", kind: "checkup", locationId: "nope", scheduledStart: "2026-09-22T09:00:00Z" } })).rejects.toMatchObject({ code: "practice_not_found" });
    await expect(scheduleAnimalAppointment({ organizationId: ORG, actor: ACTOR, command: { animalProfileId: "animal-1", kind: "checkup", scheduledStart: "" } })).rejects.toMatchObject({ code: "invalid_input" });
    expect(prisma.careAppointment.create).not.toHaveBeenCalled();
  });
});

describe("closeAnimalAppointment", () => {
  function booked(status = "booked") {
    return { id: "appt-1", status, version: 1, subjectRef: "animal-profile:animal-1", footprintEnd: new Date("2026-09-29T10:30:00Z"), recoveryMinutes: 10080 };
  }

  it("closes a done sterilization and writes the procedure onto the intake checklist with the recovery end", async () => {
    vi.mocked(prisma.careAppointment.findFirst).mockResolvedValue(booked() as never);
    vi.mocked(prisma.careIntakePacket.findFirst).mockResolvedValue({ id: "pk-1", requirementSnapshot: buildAnimalIntakeRequirementSnapshot() } as never);
    vi.mocked(prisma.careRecord.create).mockResolvedValue({ id: "cr-1" } as never);
    const result = await closeAnimalAppointment({ organizationId: ORG, actor: ACTOR, now: NOW, command: { appointmentId: "appt-1", expectedVersion: 1, outcome: "fulfilled", procedure: { requirementKey: "sterilization", provider: "Dr Julia" } } });
    expect(result).toEqual({ appointmentId: "appt-1", version: 2, careRecordId: "cr-1" });
    expect(prisma.careAppointment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "fulfilled", version: 2 }) }));
    const record = (vi.mocked(prisma.careRecord.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(record).toMatchObject({ kind: "procedure", subjectRef: "animal-profile:animal-1", detail: expect.objectContaining({ requirementKey: "sterilization", provider: "Dr Julia", outcome: "completed", recoveryUntil: "2026-09-29T10:30:00.000Z" }) });
  });

  it("a cancellation needs a reason, lifts the recovery footprint, and records no evidence", async () => {
    vi.mocked(prisma.careAppointment.findFirst).mockResolvedValue(booked() as never);
    await expect(closeAnimalAppointment({ organizationId: ORG, actor: ACTOR, command: { appointmentId: "appt-1", expectedVersion: 1, outcome: "cancelled" } })).rejects.toMatchObject({ code: "invalid_input" });
    const result = await closeAnimalAppointment({ organizationId: ORG, actor: ACTOR, now: NOW, command: { appointmentId: "appt-1", expectedVersion: 1, outcome: "cancelled", reason: "Practice closed" } });
    expect(result.careRecordId).toBeNull();
    expect(prisma.careAppointment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled", cancellationReason: "Practice closed", footprintEnd: NOW }) }));
    expect(prisma.careRecord.create).not.toHaveBeenCalled();
  });

  it("refuses a stale version and a visit already closed", async () => {
    vi.mocked(prisma.careAppointment.findFirst).mockResolvedValue(booked("fulfilled") as never);
    await expect(closeAnimalAppointment({ organizationId: ORG, actor: ACTOR, command: { appointmentId: "appt-1", expectedVersion: 2, outcome: "fulfilled" } })).rejects.toMatchObject({ code: "stale_version" });
    await expect(closeAnimalAppointment({ organizationId: ORG, actor: ACTOR, command: { appointmentId: "appt-1", expectedVersion: 1, outcome: "fulfilled" } })).rejects.toMatchObject({ code: "illegal_transition" });
  });
});

describe("loadVeterinaryWorkspace", () => {
  it("projects booked and recovering visits with the animal's name and the practice, plus practices and animals", async () => {
    vi.mocked(prisma.careAppointment.findMany).mockResolvedValue([
      { id: "a1", version: 1, status: "booked", subjectRef: "animal-profile:animal-1", scheduledStart: new Date("2026-09-22T09:00:00Z"), scheduledEnd: new Date("2026-09-22T10:30:00Z"), footprintEnd: new Date("2026-09-29T10:30:00Z"), recoveryMinutes: 10080, encounterRef: "Fasting", visitType: { code: "vet-sterilization", name: "Spay / neuter surgery" }, location: { name: "Oak & Prairie Vets" } },
      { id: "a2", version: 3, status: "fulfilled", subjectRef: "animal-profile:animal-1", scheduledStart: new Date("2026-09-15T09:00:00Z"), scheduledEnd: new Date("2026-09-15T10:00:00Z"), footprintEnd: new Date("2026-09-19T10:00:00Z"), recoveryMinutes: 1440, encounterRef: null, visitType: { code: "vet-dental", name: "Dental" }, location: null },
    ] as never);
    vi.mocked(prisma.careLocation.findMany).mockResolvedValue([{ id: "loc-1", name: "Oak & Prairie Vets", address: { kind: "partner-practice", supplierId: "sup", contactName: "Dr Julia", phone: null, arrangement: "Charity rate" } }] as never);
    vi.mocked(prisma.animalProfile.findMany).mockResolvedValue([{ id: "animal-1", name: "Ranger", animalRef: "AN-1" }] as never);
    const ws = await loadVeterinaryWorkspace({ organizationId: ORG, now: NOW });
    expect(ws.appointments.map((a) => [a.kind, a.animalName, a.practiceName, a.inRecovery])).toEqual([["sterilization", "Ranger", "Oak & Prairie Vets", false], ["dental", "Ranger", null, true]]);
    expect(ws.practices[0]).toMatchObject({ name: "Oak & Prairie Vets", contactName: "Dr Julia", arrangement: "Charity rate" });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});
