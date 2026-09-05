import { describe, expect, it } from "vitest";

import {
  ORGANIZATION_JOIN_ACTION_TYPES,
  parseOrganizationJoinDispatchParameters,
  parseOrganizationJoinPackage,
  parseOrganizationJoinPackageMaterial,
  parseOrganizationJoinRequest,
  requiredOrganizationTrustRole,
} from "./organization-join-action";

const NOW = new Date("2026-07-22T10:00:00.000Z");

function joinPackage(overrides: Record<string, string> = {}): string {
  const fields = {
    package_id: "0123456789abcdef0123456789abcdef",
    ca_url: "https://founder-hub.local:9000",
    root_fingerprint: "A".repeat(64),
    intended_hostname: "windows-dev.local",
    intended_sans: "windows-dev.local,192.168.1.42",
    expires_at: String(Math.floor(NOW.getTime() / 1000) + 600),
    enrollment_token: "token-safe_123",
    edge_client_enrollment_token: "edge-safe_456",
    ...overrides,
  };
  return [
    "DPF_ORGANIZATION_JOIN_V2",
    ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n");
}

describe("parseOrganizationJoinPackageMaterial", () => {
  it("exposes the enrollment token to the member portal while the preview never carries it", () => {
    const material = parseOrganizationJoinPackageMaterial(joinPackage(), NOW);
    expect(material.ok).toBe(true);
    if (!material.ok) throw new Error(material.reason);
    expect(material.value.enrollmentToken).toBe("token-safe_123");
    expect(material.value.intendedPeer).toBe("windows-dev.local");
    expect(material.value.intendedSans).toEqual(["windows-dev.local", "192.168.1.42"]);
    const preview = parseOrganizationJoinPackage(joinPackage(), NOW);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.reason);
    expect("enrollmentToken" in preview.value).toBe(false);
  });

  it("refuses the same tampered, expired and malformed files the preview refuses", () => {
    expect(parseOrganizationJoinPackageMaterial(joinPackage({ expires_at: String(Math.floor(NOW.getTime() / 1000) - 1) }), NOW)).toEqual({ ok: false, reason: "join-package-expired" });
    expect(parseOrganizationJoinPackageMaterial(joinPackage({ enrollment_token: "bad token!" }), NOW)).toEqual({ ok: false, reason: "invalid-enrollment-authority" });
    expect(parseOrganizationJoinPackageMaterial(["DPF_ORGANIZATION_JOIN_V1", "package_id=x"].join("\n"), NOW).ok).toBe(false);
  });
});

describe("organization join action registry", () => {
  it("contains exactly the two founder-approved action types and binds their host roles", () => {
    expect(ORGANIZATION_JOIN_ACTION_TYPES).toEqual([
      "organization.join.issue",
      "organization.join.import",
    ]);
    expect(requiredOrganizationTrustRole("organization.join.issue")).toBe("authority");
    expect(requiredOrganizationTrustRole("organization.join.import")).toBe("member");
  });

  it("accepts only the canonical issue request schema", () => {
    expect(parseOrganizationJoinRequest("organization.join.issue", {
      intendedPeer: "windows-dev.local",
      ttlSeconds: 600,
    })).toEqual({ ok: true, value: { intendedPeer: "windows-dev.local", ttlSeconds: 600 } });

    for (const parameters of [
      { intendedPeer: "windows-dev.local", ttlSeconds: 600, command: "whoami" },
      { intendedPeer: "../../etc/passwd", ttlSeconds: 600 },
      { intendedPeer: "peer.local; reboot", ttlSeconds: 600 },
      { intendedPeer: "peer.local", ttlSeconds: 299 },
      { intendedPeer: "peer.local", ttlSeconds: 901 },
    ]) {
      expect(parseOrganizationJoinRequest("organization.join.issue", parameters).ok).toBe(false);
    }
  });

  it("validates and previews a V2 package without exposing its credentials", () => {
    const parsed = parseOrganizationJoinPackage(joinPackage(), NOW);
    expect(parsed).toEqual({
      ok: true,
      value: {
        packageId: "0123456789abcdef0123456789abcdef",
        caUrl: "https://founder-hub.local:9000",
        rootFingerprint: "A".repeat(64),
        intendedPeer: "windows-dev.local",
        intendedSans: ["windows-dev.local", "192.168.1.42"],
        expiresAt: new Date("2026-07-22T10:10:00.000Z"),
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("token-safe");
  });

  it("rejects expired, public-authority, duplicate, unknown-field, and malformed packages", () => {
    const cases = [
      joinPackage({ expires_at: String(Math.floor(NOW.getTime() / 1000) - 1) }),
      joinPackage({ ca_url: "https://example.com:9000" }),
      joinPackage() + "unexpected=value\n",
      joinPackage().replace("package_id=", "package_id=bad\npackage_id="),
      joinPackage().replace("edge_client_enrollment_token=edge-safe_456\n", ""),
      "DPF_ORGANIZATION_JOIN_V1\npackage_id=0123456789abcdef0123456789abcdef\n",
    ];
    for (const value of cases) expect(parseOrganizationJoinPackage(value, NOW).ok).toBe(false);
  });

  it("accepts plaintext only at the dispatch boundary and encrypted material only at rest", () => {
    expect(parseOrganizationJoinRequest("organization.join.import", { joinPackage: joinPackage() }, NOW).ok).toBe(true);
    expect(parseOrganizationJoinRequest("organization.join.import", { joinPackageEnc: "enc:iv:tag:cipher" }, NOW).ok).toBe(false);
    expect(parseOrganizationJoinDispatchParameters("organization.join.import", { joinPackage: joinPackage() }, NOW).ok).toBe(true);
    expect(parseOrganizationJoinDispatchParameters("organization.join.import", { joinPackageEnc: "enc:iv:tag:cipher" }, NOW).ok).toBe(false);
  });
});
