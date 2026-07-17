import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listCareIntakeReviewQueue,
  revokeCareIntakeAccessGrant,
  type CareIntakeReviewDatabase,
} from "./care-intake-review-repository";

function database() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    careIntakePacket: {
      findMany: vi.fn().mockResolvedValue([{
        id: "packet-row-a", packetId: "intake-a", patientProfileId: "patient-a",
        appointmentId: "appointment-a", status: "in-progress", version: 2,
        sourceMode: "staff-assisted", dueAt: null, completionPercent: 50,
        requirementSnapshot: [{
          dynamicFormId: "form-a", dynamicFormVersion: 1, linkId: "visit-reason",
          dataCategory: "visit-reason", required: true,
        }],
        requiredConsentCount: 0, requiresCoverageEvidence: false,
        responses: [{ answeredLinkIds: ["visit-reason"], sourceMode: "staff-assisted", status: "in-progress", authoredAt: new Date("2026-08-01") }],
        exceptions: [], consentAttestations: [], coverageEvidence: [],
        accessGrants: [{ grantId: "grant-a", granteePrincipalId: "principal-patient-a", permittedOperations: ["view"], expiresAt: new Date("2026-08-02"), lastUsedAt: null, revokedAt: null }],
      }]),
      findFirst: vi.fn().mockResolvedValue({ id: "packet-row-a", packetId: "intake-a", patientProfileId: "patient-a" }),
    },
    careIntakeAccessGrant: {
      findFirst: vi.fn().mockResolvedValue({ grantId: "grant-a", revokedAt: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    authorizationDecisionLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return { tx, db: { $transaction: vi.fn((callback) => callback(tx)) } as unknown as CareIntakeReviewDatabase };
}

describe("care intake receptionist review repository", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"));

  it("returns readiness and provenance without response answer payloads", async () => {
    const { db, tx } = database();
    const result = await listCareIntakeReviewQueue({
      organizationId: "org-a", actorPrincipalId: "principal-receptionist", limit: 25,
    }, db);

    expect(result.items[0]).toEqual(expect.objectContaining({
      packetId: "intake-a", ready: true, completionPercent: 100,
      sourceModes: ["staff-assisted"], openExceptions: [],
    }));
    expect(JSON.stringify(result)).not.toContain("answers");
    expect(tx.authorizationDecisionLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorRef: "principal-receptionist", actionKey: "healthcare.intake.review",
      purposeOfUse: "intake-review", decision: "allow",
    }) });
  });

  it("revokes only an active grant and records immutable decision evidence", async () => {
    const { db, tx } = database();
    const result = await revokeCareIntakeAccessGrant({
      organizationId: "org-a", packetId: "intake-a", grantId: "grant-a",
      actorPrincipalId: "principal-receptionist", reason: "patient-requested",
    }, db);

    expect(result).toEqual({ grantId: "grant-a", status: "revoked", revokedAt: new Date("2026-08-01T14:00:00.000Z") });
    expect(tx.careIntakeAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { grantId: "grant-a", packetId: "packet-row-a", organizationId: "org-a", revokedAt: null },
      data: { revokedAt: new Date("2026-08-01T14:00:00.000Z"), revocationReason: "patient-requested" },
    });
    expect(tx.authorizationDecisionLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actionKey: "healthcare.intake.grant.revoke", objectRef: "care-intake-grant:grant-a",
    }) });
  });
});
