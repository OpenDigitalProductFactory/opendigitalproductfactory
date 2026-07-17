import { describe, expect, it, vi } from "vitest";

import {
  getCareIntakeReadiness,
  transitionCareIntakePacket,
  type CareIntakeDatabase,
} from "./care-intake-repository";

function makeDatabase() {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    careIntakePacket: {
      findFirst: vi.fn(async () => ({
        id: "packet-row",
        packetId: "packet-a",
        organizationId: "org-a",
        patientProfileId: "patient-a",
        status: "in-progress",
        version: 2,
        requirementSnapshot: [
          { dynamicFormId: "form-row-intake", dynamicFormVersion: 1, linkId: "phone", dataCategory: "contact", required: true },
          { dynamicFormId: "form-row-intake", dynamicFormVersion: 1, linkId: "reason", dataCategory: "visit-reason", required: true },
        ],
        requiredConsentCount: 1,
        requiresCoverageEvidence: true,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    careIntakeResponse: {
      findMany: vi.fn(async () => [{ answeredLinkIds: ["phone"] }]),
    },
    careIntakeException: {
      count: vi.fn(async () => 1),
    },
    careConsentAttestation: {
      count: vi.fn(async () => 0),
    },
    careCoverageEvidence: {
      count: vi.fn(async () => 0),
    },
    careIntakeStatusEvent: {
      create: vi.fn(async () => ({})),
    },
  };
  const database: CareIntakeDatabase = {
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
  return { database, tx };
}

describe("care intake repository", () => {
  it("returns readiness metadata without returning answer payloads", async () => {
    const { database } = makeDatabase();
    await expect(
      getCareIntakeReadiness(
        {
          organizationId: "org-a",
          patientProfileId: "patient-a",
          patientPrincipalId: "patient-principal-a",
          packetId: "packet-a",
        },
        database,
      ),
    ).resolves.toEqual({
      packetId: "packet-a",
      status: "in-progress",
      version: 2,
      ready: false,
      completionPercent: 20,
      missingRequiredLinkIds: ["reason"],
      blockers: [
        "required-answers-missing",
        "consent-incomplete",
        "coverage-unverified",
        "exceptions-unresolved",
      ],
    });
  });

  it("uses optimistic concurrency and appends lifecycle evidence", async () => {
    const { database, tx } = makeDatabase();
    tx.careIntakeException.count.mockResolvedValueOnce(0);
    tx.careConsentAttestation.count.mockResolvedValueOnce(1);
    tx.careCoverageEvidence.count.mockResolvedValueOnce(1);
    tx.careIntakeResponse.findMany.mockResolvedValueOnce([
      { answeredLinkIds: ["phone", "reason"] },
    ]);

    await expect(
      transitionCareIntakePacket(
        {
          organizationId: "org-a",
          patientProfileId: "patient-a",
          patientPrincipalId: "patient-principal-a",
          packetId: "packet-a",
          expectedVersion: 2,
          toStatus: "completed",
          reason: "Patient submitted intake",
          sourceMode: "patient-mobile",
          actorPrincipalId: "patient-principal-a",
        },
        database,
      ),
    ).resolves.toEqual({
      ok: true,
      packetId: "packet-a",
      status: "completed",
      version: 3,
    });
    expect(tx.careIntakePacket.updateMany).toHaveBeenCalledWith({
      where: {
        id: "packet-row",
        organizationId: "org-a",
        status: "in-progress",
        version: 2,
      },
      data: expect.objectContaining({
        status: "completed",
        version: 3,
        completionPercent: 100,
      }),
    });
    expect(tx.careIntakeStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        packetVersion: 3,
        fromStatus: "in-progress",
        toStatus: "completed",
      }),
    });
  });
});
