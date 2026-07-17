import { describe, expect, it } from "vitest";

import {
  assertCareIntakeGrant,
  createCareIntakeResumeToken,
  digestCareIntakeResumeToken,
  parseCareIntakeResumeToken,
} from "./care-intake-access";

describe("care intake resume token", () => {
  it("round-trips opaque RLS bootstrap claims without storing the raw token", () => {
    const issued = createCareIntakeResumeToken({
      organizationId: "org-a",
      patientProfileId: "patient-a",
      grantId: "intake-grant-a",
    });

    expect(parseCareIntakeResumeToken(issued.token)).toEqual({
      organizationId: "org-a",
      patientProfileId: "patient-a",
      grantId: "intake-grant-a",
    });
    expect(issued.digest).toBe(digestCareIntakeResumeToken(issued.token));
    expect(issued.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.digest).not.toContain(issued.token);
  });

  it("rejects malformed and tampered token envelopes before database access", () => {
    const issued = createCareIntakeResumeToken({
      organizationId: "org-a",
      patientProfileId: "patient-a",
      grantId: "intake-grant-a",
    });
    const [envelope, secret] = issued.token.split(".");

    expect(() => parseCareIntakeResumeToken("not-a-token")).toThrow(
      "Invalid care intake resume token",
    );
    expect(() =>
      parseCareIntakeResumeToken(`${envelope}.${secret?.slice(1)}`),
    ).toThrow("Invalid care intake resume token");
    expect(() =>
      parseCareIntakeResumeToken(
        `${Buffer.from(JSON.stringify({ organizationId: "org-b" })).toString("base64url")}.${secret}`,
      ),
    ).toThrow("Invalid care intake resume token");
  });
});

describe("care intake grant enforcement", () => {
  const grant = {
    grantId: "intake-grant-a",
    packetId: "packet-row-a",
    patientProfileId: "patient-a",
    tokenDigest: "digest-a",
    permittedOperations: ["view", "save"],
    expiresAt: new Date("2026-08-01T15:00:00.000Z"),
    revokedAt: null,
  };

  it("allows only the token, packet, patient, operation, and time in scope", () => {
    expect(() =>
      assertCareIntakeGrant(grant, {
        digest: "digest-a",
        grantId: "intake-grant-a",
        packetRowId: "packet-row-a",
        patientProfileId: "patient-a",
        operation: "save",
        at: new Date("2026-08-01T14:00:00.000Z"),
      }),
    ).not.toThrow();
  });

  it.each([
    ["digest-b", "intake-grant-a", "packet-row-a", "patient-a", "save", "2026-08-01T14:00:00.000Z"],
    ["digest-a", "intake-grant-b", "packet-row-a", "patient-a", "save", "2026-08-01T14:00:00.000Z"],
    ["digest-a", "intake-grant-a", "packet-row-b", "patient-a", "save", "2026-08-01T14:00:00.000Z"],
    ["digest-a", "intake-grant-a", "packet-row-a", "patient-b", "save", "2026-08-01T14:00:00.000Z"],
    ["digest-a", "intake-grant-a", "packet-row-a", "patient-a", "submit", "2026-08-01T14:00:00.000Z"],
    ["digest-a", "intake-grant-a", "packet-row-a", "patient-a", "save", "2026-08-01T15:00:00.000Z"],
  ])("denies a mismatched or expired grant", (digest, grantId, packetRowId, patientProfileId, operation, at) => {
    expect(() =>
      assertCareIntakeGrant(grant, {
        digest,
        grantId,
        packetRowId,
        patientProfileId,
        operation: operation as "save" | "submit",
        at: new Date(at),
      }),
    ).toThrow("Care intake access denied");
  });

  it("denies a revoked grant", () => {
    expect(() =>
      assertCareIntakeGrant(
        { ...grant, revokedAt: new Date("2026-08-01T13:00:00.000Z") },
        {
          digest: "digest-a",
          grantId: "intake-grant-a",
          packetRowId: "packet-row-a",
          patientProfileId: "patient-a",
          operation: "view",
          at: new Date("2026-08-01T14:00:00.000Z"),
        },
      ),
    ).toThrow("Care intake access denied");
  });
});
