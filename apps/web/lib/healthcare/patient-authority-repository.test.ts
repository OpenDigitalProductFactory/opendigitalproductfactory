import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  evaluateAndRecordPatientAuthority,
  withPatientDataContext,
} from "./patient-authority-repository";

const NOW = new Date("2026-07-16T12:00:00.000Z");

function createHarness() {
  const order: string[] = [];
  const patientProfile = {
    id: "patient-profile-a",
    organizationId: "org-a",
    principalId: "principal-patient",
    status: "active",
    minorStatus: "adult",
    selfAccessAllowed: true,
  };
  const tx = {
    $executeRaw: vi.fn(async () => {
      order.push("context");
      return 1;
    }),
    patientProfile: {
      findFirst: vi.fn<() => Promise<typeof patientProfile | null>>(
        async () => {
          order.push("profile");
          return patientProfile;
        },
      ),
    },
    patientAuthority: {
      findMany: vi.fn(async () => {
        order.push("authority");
        return [
          {
            id: "authority-row-a",
            authorityId: "authority-a",
            organizationId: "org-a",
            patientProfileId: "patient-profile-a",
            granteePrincipalId: "principal-proxy",
            relationshipType: "proxy",
            status: "active",
            purposesOfUse: ["patient-support"],
            permittedOperations: ["view"],
            recordCategories: ["appointments"],
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            expiresAt: null,
            revokedAt: null,
            version: 2,
          },
        ];
      }),
    },
    patientConsentDirective: {
      findMany: vi.fn(async () => {
        order.push("directive");
        return [];
      }),
    },
    authorizationDecisionLog: {
      create: vi.fn(async ({ data }) => {
        order.push("decision");
        return data;
      }),
    },
  };
  const db = {
    $transaction: vi.fn(async (callback) => callback(tx)),
  };

  return { db, tx, order };
}

describe("withPatientDataContext", () => {
  it("establishes transaction-local tenant and patient context before work", async () => {
    const { db, tx, order } = createHarness();
    const callback = vi.fn(async () => {
      order.push("callback");
      return "ok";
    });

    await expect(
      withPatientDataContext(
        {
          organizationId: "org-a",
          patientPrincipalIds: ["principal-patient"],
        },
        callback,
        db,
      ),
    ).resolves.toBe("ok");

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["context", "callback"]);
  });

  it.each([
    { organizationId: "", patientPrincipalIds: ["principal-patient"] },
    { organizationId: "org-a", patientPrincipalIds: [] },
    { organizationId: "org-a", patientPrincipalIds: ["patient,other"] },
  ])("fails closed for invalid context %#", async (context) => {
    const { db, tx } = createHarness();

    await expect(
      withPatientDataContext(context, vi.fn(), db),
    ).rejects.toThrow("Invalid patient data context");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("evaluateAndRecordPatientAuthority", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("queries one tenant/patient and records immutable decision evidence in the same transaction", async () => {
    const { db, tx, order } = createHarness();

    const result = await evaluateAndRecordPatientAuthority(
      {
        organizationId: "org-a",
        actorPrincipalId: "principal-proxy",
        actorType: "human",
        patientPrincipalId: "principal-patient",
        purposeOfUse: "patient-support",
        operation: "view",
        recordCategory: "appointments",
        at: NOW,
        accessMode: "ordinary",
        emergencyAccess: null,
      },
      db,
    );

    expect(result).toMatchObject({
      effect: "allow",
      reasonCodes: ["matched-patient-authority"],
      matchedAuthorityId: "authority-a",
    });
    expect(order).toEqual([
      "context",
      "profile",
      "authority",
      "directive",
      "decision",
    ]);
    expect(tx.patientProfile.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-a",
        principalId: "principal-patient",
      },
    });
    expect(tx.patientAuthority.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-a",
          patientProfileId: "patient-profile-a",
          status: "active",
        }),
      }),
    );
    expect(tx.authorizationDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-a",
        patientSubjectPrincipalId: "principal-patient",
        patientAuthorityId: "authority-row-a",
        purposeOfUse: "patient-support",
        decision: "allow",
        policyVersion: "healthcare-patient-authority/v1",
      }),
    });
  });

  it("denies and records a missing patient profile without querying authority rows", async () => {
    const { db, tx } = createHarness();
    tx.patientProfile.findFirst.mockResolvedValueOnce(null);

    const result = await evaluateAndRecordPatientAuthority(
      {
        organizationId: "org-a",
        actorPrincipalId: "principal-proxy",
        actorType: "human",
        patientPrincipalId: "principal-patient",
        purposeOfUse: "patient-support",
        operation: "view",
        recordCategory: "appointments",
        at: NOW,
        accessMode: "ordinary",
        emergencyAccess: null,
      },
      db,
    );

    expect(result).toMatchObject({
      effect: "deny",
      reasonCodes: ["patient-profile-unavailable"],
    });
    expect(tx.patientAuthority.findMany).not.toHaveBeenCalled();
    expect(tx.patientConsentDirective.findMany).not.toHaveBeenCalled();
    expect(tx.authorizationDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decision: "deny",
        patientAuthorityId: null,
        patientConsentDirectiveId: null,
      }),
    });
  });
});
