import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  decideCareConsentAttestation,
  decideCareCoverageEvidence,
  stageCareConsentAttestation,
  stageCareCoverageEvidence,
  type CareIntakeEvidenceDatabase,
} from "./care-intake-evidence-repository";

function database() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    careIntakePacket: {
      findFirst: vi.fn().mockResolvedValue({
        id: "packet-row-a", packetId: "intake-a", patientProfileId: "patient-a",
      }),
    },
    patientConsentDirective: {
      findFirst: vi.fn().mockResolvedValue({ id: "directive-row-a", directiveId: "directive-a" }),
    },
    careIntakeResponse: {
      findFirst: vi.fn().mockResolvedValue({ id: "response-row-a" }),
    },
    careCoverageEvidence: {
      upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ ...create })),
      findFirst: vi.fn().mockResolvedValue({
        id: "coverage-row-a", evidenceId: "coverage-a", status: "pending-review",
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    careConsentAttestation: {
      upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ ...create })),
      findFirst: vi.fn().mockResolvedValue({
        id: "attestation-row-a", attestationId: "attestation-a", status: "pending-review",
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    authorizationDecisionLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    db: { $transaction: vi.fn((callback) => callback(tx)) } as unknown as CareIntakeEvidenceDatabase,
  };
}

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

describe("care intake reviewed evidence repository", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"));

  it("stages coverage as pending evidence without making it canonical coverage", async () => {
    const { db, tx } = database();
    const result = await stageCareCoverageEvidence({
      organizationId: "org-a", packetId: "intake-a", actorPrincipalId: "principal-receptionist",
      idempotencyKey: "upload-a", fundingType: "commercial", payerOrProgramName: "Example Payer",
      memberIdentifierLast4: "9X2A", evidenceRef: "object://coverage/a", evidenceDigest: digestA,
    }, db);

    expect(result).toEqual(expect.objectContaining({ status: "pending-review", canonicalCoverageCreated: false }));
    expect(JSON.stringify(result)).not.toContain("object://coverage/a");
    expect(tx.careCoverageEvidence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        organizationId: "org-a", packetId: "packet-row-a", patientProfileId: "patient-a",
        status: "pending-review", evidenceRef: "object://coverage/a", evidenceDigest: digestA,
      }),
    }));
    expect(tx.authorizationDecisionLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actionKey: "healthcare.intake.coverage-evidence.stage", decision: "allow",
    }) });
  });

  it("stages consent evidence against an existing patient directive", async () => {
    const { db, tx } = database();
    const result = await stageCareConsentAttestation({
      organizationId: "org-a", packetId: "intake-a", actorPrincipalId: "principal-receptionist",
      idempotencyKey: "signature-a", patientConsentDirectiveId: "directive-a",
      responseId: "response-row-a", documentRef: "object://consent/a", documentDigest: digestA,
      documentVersion: "v3", signatureEvidenceRef: "object://signature/a", signatureDigest: digestB,
      signatureMethod: "drawn", signerPrincipalId: "principal-patient", attestedAt: new Date("2026-08-01T13:55:00Z"),
    }, db);

    expect(result).toEqual(expect.objectContaining({ status: "pending-review", consentDirectiveChanged: false }));
    expect(tx.patientConsentDirective.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ directiveId: "directive-a", patientProfileId: "patient-a" }),
    }));
    expect(tx.careConsentAttestation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        patientConsentDirectiveId: "directive-row-a", responseId: "response-row-a",
        signatureEvidenceRef: "object://signature/a", signatureDigest: digestB,
      }),
    }));
  });

  it("accepts pending coverage only through an explicit reviewer decision", async () => {
    const { db, tx } = database();
    const result = await decideCareCoverageEvidence({
      organizationId: "org-a", packetId: "intake-a", evidenceId: "coverage-a",
      actorPrincipalId: "principal-reviewer", decision: "accepted",
    }, db);

    expect(result).toEqual({ evidenceId: "coverage-a", status: "accepted", canonicalCoverageCreated: false });
    expect(tx.careCoverageEvidence.updateMany).toHaveBeenCalledWith({
      where: { id: "coverage-row-a", status: "pending-review" },
      data: {
        status: "accepted", verifiedAt: new Date("2026-08-01T14:00:00.000Z"),
        verifiedByPrincipalId: "principal-reviewer", rejectionReason: null,
      },
    });
  });

  it("rejects pending consent with a reason and does not alter consent authority", async () => {
    const { db, tx } = database();
    const result = await decideCareConsentAttestation({
      organizationId: "org-a", packetId: "intake-a", attestationId: "attestation-a",
      actorPrincipalId: "principal-reviewer", decision: "rejected", reason: "signature-does-not-match",
    }, db);

    expect(result).toEqual({ attestationId: "attestation-a", status: "rejected", consentDirectiveChanged: false });
    expect(tx.careConsentAttestation.updateMany).toHaveBeenCalledWith({
      where: { id: "attestation-row-a", status: "pending-review" },
      data: {
        status: "rejected", acceptedAt: null, acceptedByPrincipalId: null,
        rejectionReason: "signature-does-not-match",
      },
    });
  });
});
