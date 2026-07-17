import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/auth-middleware.js", () => ({
  requireEmployeeAuth: vi.fn(),
  requireCapability: vi.fn(),
}));
vi.mock("../../healthcare/care-intake-evidence-repository.js", () => ({
  stageCareCoverageEvidence: vi.fn(),
  decideCareCoverageEvidence: vi.fn(),
  stageCareConsentAttestation: vi.fn(),
  decideCareConsentAttestation: vi.fn(),
}));

import { POST as stageCoverage } from "../../../app/api/v1/healthcare/intake/[packetId]/coverage-evidence/route.js";
import { POST as decideCoverage } from "../../../app/api/v1/healthcare/intake/[packetId]/coverage-evidence/[evidenceId]/decision/route.js";
import { POST as stageConsent } from "../../../app/api/v1/healthcare/intake/[packetId]/consent-attestations/route.js";
import { POST as decideConsent } from "../../../app/api/v1/healthcare/intake/[packetId]/consent-attestations/[attestationId]/decision/route.js";
import { requireCapability, requireEmployeeAuth } from "../../api/auth-middleware.js";
import {
  decideCareConsentAttestation,
  decideCareCoverageEvidence,
  stageCareConsentAttestation,
  stageCareCoverageEvidence,
} from "../../healthcare/care-intake-evidence-repository.js";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

function post(body: unknown) {
  return new Request("http://localhost", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireEmployeeAuth).mockResolvedValue({
    user: { id: "user-reception", type: "admin" } as never,
    capabilities: ["operate_customer"],
    authContext: { principalId: "principal-receptionist" } as never,
  });
});

describe("healthcare intake reviewed evidence endpoints", () => {
  it("requires customer-operation authority to stage coverage evidence", async () => {
    vi.mocked(stageCareCoverageEvidence).mockResolvedValue({
      evidenceId: "coverage-a", status: "pending-review", canonicalCoverageCreated: false,
    });
    const response = await stageCoverage(post({
      organizationId: "org-a", idempotencyKey: "upload-a", fundingType: "commercial",
      evidenceRef: "object://coverage/a", evidenceDigest: digestA,
    }), { params: Promise.resolve({ packetId: "intake-a" }) });
    expect(response.status).toBe(200);
    expect(requireCapability).toHaveBeenCalledWith(["operate_customer"], "operate_customer");
    expect(stageCareCoverageEvidence).toHaveBeenCalledWith(expect.objectContaining({
      packetId: "intake-a", actorPrincipalId: "principal-receptionist", evidenceDigest: digestA,
    }));
  });

  it("requires an explicit coverage accept/reject decision", async () => {
    vi.mocked(decideCareCoverageEvidence).mockResolvedValue({
      evidenceId: "coverage-a", status: "accepted", canonicalCoverageCreated: false,
    });
    const response = await decideCoverage(post({ organizationId: "org-a", decision: "accepted" }), {
      params: Promise.resolve({ packetId: "intake-a", evidenceId: "coverage-a" }),
    });
    expect(response.status).toBe(200);
    expect(decideCareCoverageEvidence).toHaveBeenCalledWith(expect.objectContaining({
      evidenceId: "coverage-a", decision: "accepted", actorPrincipalId: "principal-receptionist",
    }));
  });

  it("stages consent evidence without changing the consent directive", async () => {
    vi.mocked(stageCareConsentAttestation).mockResolvedValue({
      attestationId: "attestation-a", status: "pending-review", consentDirectiveChanged: false,
    });
    const response = await stageConsent(post({
      organizationId: "org-a", idempotencyKey: "signature-a", patientConsentDirectiveId: "directive-a",
      documentRef: "object://consent/a", documentDigest: digestA, documentVersion: "v3",
      signatureEvidenceRef: "object://signature/a", signatureDigest: digestB,
      signatureMethod: "drawn", signerPrincipalId: "principal-patient", attestedAt: "2026-08-01T13:55:00Z",
    }), { params: Promise.resolve({ packetId: "intake-a" }) });
    expect(response.status).toBe(200);
    expect(stageCareConsentAttestation).toHaveBeenCalledWith(expect.objectContaining({
      packetId: "intake-a", patientConsentDirectiveId: "directive-a",
      attestedAt: new Date("2026-08-01T13:55:00Z"),
    }));
  });

  it("requires a reason for a rejected consent attestation", async () => {
    vi.mocked(decideCareConsentAttestation).mockResolvedValue({
      attestationId: "attestation-a", status: "rejected", consentDirectiveChanged: false,
    });
    const response = await decideConsent(post({
      organizationId: "org-a", decision: "rejected", reason: "signature-does-not-match",
    }), { params: Promise.resolve({ packetId: "intake-a", attestationId: "attestation-a" }) });
    expect(response.status).toBe(200);
    expect(decideCareConsentAttestation).toHaveBeenCalledWith(expect.objectContaining({
      attestationId: "attestation-a", decision: "rejected", reason: "signature-does-not-match",
    }));
  });
});
