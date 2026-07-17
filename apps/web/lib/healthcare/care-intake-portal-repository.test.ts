import { describe, expect, it, vi } from "vitest";

import {
  issuePatientCareIntakeGrant,
  listPatientCareTasks,
  type PatientPortalDatabase,
} from "./care-intake-portal-repository";

function database(overrides: Record<string, unknown> = {}) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    patientProfile: {
      findFirst: vi.fn().mockResolvedValue({
        id: "patient-row-a",
        patientId: "PATIENT-A",
        organizationId: "org-a",
        principalId: "principal-patient-a",
      }),
    },
    careIntakePacket: {
      findMany: vi.fn().mockResolvedValue([
        {
          packetId: "intake-a",
          status: "in-progress",
          dueAt: new Date("2026-08-02T14:00:00.000Z"),
          completionPercent: 50,
          appointmentId: "appointment-row-a",
          sourceMode: "patient",
          updatedAt: new Date("2026-08-01T12:00:00.000Z"),
        },
      ]),
    },
    ...overrides,
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    } as unknown as PatientPortalDatabase,
  };
}

describe("patient care portal intake repository", () => {
  it("lists only minimum-necessary intake tasks for the authenticated patient principal", async () => {
    const { db, tx } = database();

    const result = await listPatientCareTasks(
      { organizationId: "org-a", actorPrincipalId: "principal-patient-a" },
      db,
    );

    expect(tx.$executeRaw).toHaveBeenCalledBefore(tx.patientProfile.findFirst);
    expect(tx.patientProfile.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-a",
        principalId: "principal-patient-a",
        status: "active",
        mergedIntoPatientProfileId: null,
        enteredInErrorAt: null,
      },
      select: {
        id: true,
        patientId: true,
        organizationId: true,
        principalId: true,
      },
    });
    expect(tx.careIntakePacket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-a",
        patientProfileId: "patient-row-a",
        status: { in: ["assigned", "in-progress", "amended"] },
      },
    }));
    expect(result).toEqual({
      linked: true,
      tasks: [{
        packetId: "intake-a",
        status: "in-progress",
        dueAt: "2026-08-02T14:00:00.000Z",
        completionPercent: 50,
        hasAppointment: true,
        sourceMode: "patient",
        updatedAt: "2026-08-01T12:00:00.000Z",
      }],
    });
    expect(JSON.stringify(result)).not.toContain("patient-row-a");
    expect(JSON.stringify(result)).not.toContain("principal-patient-a");
  });

  it("returns an honest unlinked state without attempting packet access", async () => {
    const { db, tx } = database({
      patientProfile: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(listPatientCareTasks(
      { organizationId: "org-a", actorPrincipalId: "principal-customer-a" },
      db,
    )).resolves.toEqual({ linked: false, tasks: [] });
    expect(tx.careIntakePacket.findMany).not.toHaveBeenCalled();
  });

  it("issues a short-lived grant from server-resolved patient identity", async () => {
    const { db } = database();
    const issueGrant = vi.fn().mockResolvedValue({
      grantId: "grant-a",
      token: "resume-secret",
      expiresAt: new Date("2026-08-01T15:00:00.000Z"),
    });

    const result = await issuePatientCareIntakeGrant(
      {
        organizationId: "org-a",
        actorPrincipalId: "principal-patient-a",
        packetId: "intake-a",
        now: new Date("2026-08-01T14:00:00.000Z"),
      },
      { database: db, issueGrant },
    );

    expect(issueGrant).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a",
      packetId: "intake-a",
      patientProfileId: "patient-row-a",
      patientPrincipalId: "principal-patient-a",
      actorPrincipalId: "principal-patient-a",
      permittedOperations: ["view", "save", "submit"],
      expiresAt: new Date("2026-08-01T15:00:00.000Z"),
    }));
    expect(result).toEqual({
      grantId: "grant-a",
      token: "resume-secret",
      expiresAt: "2026-08-01T15:00:00.000Z",
    });
  });

  it("denies grant issuance when the signed-in contact has no active patient profile", async () => {
    const { db } = database({
      patientProfile: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const issueGrant = vi.fn();

    await expect(issuePatientCareIntakeGrant(
      {
        organizationId: "org-a",
        actorPrincipalId: "principal-customer-a",
        packetId: "intake-a",
        now: new Date("2026-08-01T14:00:00.000Z"),
      },
      { database: db, issueGrant },
    )).rejects.toThrow("Patient portal identity is not linked");
    expect(issueGrant).not.toHaveBeenCalled();
  });
});
