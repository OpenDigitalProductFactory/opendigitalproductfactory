import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCareIntakePacketProjection,
  issueCareIntakeResumeGrant,
  type CareIntakeApiDatabase,
} from "./care-intake-api-repository";
import { digestCareIntakeResumeToken } from "./care-intake-access";

const packet = {
  id: "packet-row-a",
  packetId: "intake-a",
  organizationId: "org-a",
  patientProfileId: "patient-a",
  status: "assigned",
  version: 1,
  dueAt: null,
  completionPercent: 0,
  purposeOfUse: "patient-intake",
  requirementSnapshot: [
    {
      dynamicFormId: "form-row-a",
      dynamicFormVersion: 2,
      linkId: "visit-reason",
      dataCategory: "visit-reason",
      required: true,
    },
  ],
  requiredConsentCount: 0,
  requiresCoverageEvidence: false,
};

function database() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    careIntakePacket: { findFirst: vi.fn().mockResolvedValue(packet) },
    careIntakeAccessGrant: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    dynamicForm: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "form-row-a",
          formId: "medical-history",
          title: "Medical history",
          version: 2,
          fields: [{ key: "visit-reason", type: "textarea", label: "Reason" }],
          submitAction: null,
          offlineCapable: true,
        },
      ]),
    },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn((callback) => callback(tx)),
    } as unknown as CareIntakeApiDatabase,
  };
}

describe("issueCareIntakeResumeGrant", () => {
  it("issues the raw token once only after an allow decision", async () => {
    const { db, tx } = database();
    const result = await issueCareIntakeResumeGrant(
      {
        organizationId: "org-a",
        patientProfileId: "patient-a",
        patientPrincipalId: "principal-patient-a",
        packetId: "intake-a",
        granteePrincipalId: "principal-patient-a",
        issuedByPrincipalId: "principal-patient-a",
        permittedOperations: ["view", "save", "submit"],
        expiresAt: new Date("2026-08-01T15:00:00.000Z"),
        authorityDecision: { effect: "allow", reasonCodes: ["patient-self-access"] },
      },
      db,
    );

    expect(result.token).toBeTruthy();
    expect(tx.careIntakeAccessGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenDigest: digestCareIntakeResumeToken(result.token),
        packetId: "packet-row-a",
        patientProfileId: "patient-a",
        granteePrincipalId: "principal-patient-a",
      }),
    });
  });

  it("does not mint a token after a denied authority decision", async () => {
    const { db, tx } = database();
    await expect(
      issueCareIntakeResumeGrant(
        {
          organizationId: "org-a",
          patientProfileId: "patient-a",
          patientPrincipalId: "principal-patient-a",
          packetId: "intake-a",
          granteePrincipalId: "principal-proxy",
          issuedByPrincipalId: "principal-proxy",
          permittedOperations: ["view"],
          expiresAt: new Date("2026-08-01T15:00:00.000Z"),
          authorityDecision: { effect: "deny", reasonCodes: ["authority-not-found"] },
        },
        db,
      ),
    ).rejects.toThrow("Patient authority denied care intake access");
    expect(tx.careIntakeAccessGrant.create).not.toHaveBeenCalled();
  });
});

describe("getCareIntakePacketProjection", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"));

  it("returns only lifecycle/readiness and packet-pinned form definitions", async () => {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant(
      {
        organizationId: "org-a",
        patientProfileId: "patient-a",
        patientPrincipalId: "principal-patient-a",
        packetId: "intake-a",
        granteePrincipalId: "principal-patient-a",
        issuedByPrincipalId: "principal-patient-a",
        permittedOperations: ["view"],
        expiresAt: new Date("2026-08-01T15:00:00.000Z"),
        authorityDecision: { effect: "allow", reasonCodes: [] },
      },
      db,
    );
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId,
      packetId: "packet-row-a",
      patientProfileId: "patient-a",
      tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["view"],
      expiresAt: new Date("2026-08-01T15:00:00.000Z"),
      revokedAt: null,
    });

    const projection = await getCareIntakePacketProjection(
      { packetId: "intake-a", token: issued.token },
      db,
    );

    expect(projection).toEqual({
      packetId: "intake-a",
      status: "assigned",
      version: 1,
      dueAt: null,
      completionPercent: 0,
      forms: [
        expect.objectContaining({ formId: "medical-history", version: 2 }),
      ],
    });
    expect(JSON.stringify(projection)).not.toContain("answers");
    expect(tx.dynamicForm.findMany).toHaveBeenCalledWith({
      where: { OR: [{ id: "form-row-a", version: 2 }] },
    });
  });
});
