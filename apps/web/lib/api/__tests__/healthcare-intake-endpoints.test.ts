import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/auth-middleware.js", () => ({
  authenticateRequest: vi.fn(),
}));
vi.mock("../../healthcare/care-intake-api-repository.js", () => ({
  authorizeAndIssueCareIntakeResumeGrant: vi.fn(),
  getCareIntakePacketProjection: vi.fn(),
}));
vi.mock("../../identity/principal-linking.js", () => ({
  resolvePrincipalRecordIdForSessionIdentity: vi.fn(),
}));

import { POST as issueGrant } from "../../../app/api/v1/healthcare/intake/[packetId]/access-grants/route.js";
import { GET as getPacket } from "../../../app/api/v1/healthcare/intake/[packetId]/route.js";
import { authenticateRequest } from "../../api/auth-middleware.js";
import {
  authorizeAndIssueCareIntakeResumeGrant,
  getCareIntakePacketProjection,
} from "../../healthcare/care-intake-api-repository.js";
import { resolvePrincipalRecordIdForSessionIdentity } from "../../identity/principal-linking.js";

const params = { params: Promise.resolve({ packetId: "intake-a" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z");
});

describe("GET /api/v1/healthcare/intake/:packetId", () => {
  it("requires a dedicated intake token instead of accepting ambient session access", async () => {
    const response = await getPacket(
      new Request("http://localhost/api/v1/healthcare/intake/intake-a"),
      params,
    );
    expect(response.status).toBe(401);
    expect(getCareIntakePacketProjection).not.toHaveBeenCalled();
  });

  it("returns the minimum-necessary token-scoped projection", async () => {
    vi.mocked(getCareIntakePacketProjection).mockResolvedValue({
      packetId: "intake-a",
      status: "assigned",
      version: 1,
      dueAt: null,
      completionPercent: 0,
      forms: [],
    });
    const response = await getPacket(
      new Request("http://localhost/api/v1/healthcare/intake/intake-a", {
        headers: { "x-intake-resume-token": "opaque-token" },
      }),
      params,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ packetId: "intake-a", forms: [] }),
    );
  });
});

describe("POST /api/v1/healthcare/intake/:packetId/access-grants", () => {
  it("binds issuance to the authenticated relational principal and a 24-hour maximum", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: {
        id: "contact-a",
        email: "patient@example.test",
        type: "customer",
        platformRole: null,
        isSuperuser: false,
        accountId: "account-a",
        accountName: "Patient",
        contactId: "contact-a",
      },
      capabilities: [],
      authContext: {} as never,
    });
    vi.mocked(resolvePrincipalRecordIdForSessionIdentity).mockResolvedValue(
      "principal-patient-a",
    );
    vi.mocked(authorizeAndIssueCareIntakeResumeGrant).mockResolvedValue({
      grantId: "grant-a",
      token: "returned-once",
      expiresAt: new Date("2026-08-01T15:00:00.000Z"),
      permittedOperations: ["view", "save"],
    });

    const response = await issueGrant(
      new Request(
        "http://localhost/api/v1/healthcare/intake/intake-a/access-grants",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId: "org-a",
            patientProfileId: "patient-a",
            patientPrincipalId: "principal-patient-a",
            permittedOperations: ["view", "save"],
            expiresAt: "2026-08-01T15:00:00.000Z",
          }),
        },
      ),
      params,
    );
    expect(response.status).toBe(201);
    expect(authorizeAndIssueCareIntakeResumeGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        packetId: "intake-a",
        actorPrincipalId: "principal-patient-a",
      }),
    );
  });

  it("rejects grants beyond 24 hours", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { id: "user-a", type: "admin" } as never,
      capabilities: [],
      authContext: {} as never,
    });
    vi.mocked(resolvePrincipalRecordIdForSessionIdentity).mockResolvedValue(
      "principal-a",
    );
    const response = await issueGrant(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: "org-a",
          patientProfileId: "patient-a",
          patientPrincipalId: "principal-patient-a",
          permittedOperations: ["view"],
          expiresAt: "2026-08-02T14:00:00.001Z",
        }),
      }),
      params,
    );
    expect(response.status).toBe(400);
    expect(authorizeAndIssueCareIntakeResumeGrant).not.toHaveBeenCalled();
  });
});
