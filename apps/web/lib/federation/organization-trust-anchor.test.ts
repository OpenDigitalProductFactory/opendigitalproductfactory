import { describe, expect, it, vi } from "vitest";

import {
  resolveOrganizationTrustAnchor,
  type JoinImportRecord,
  type OrganizationTrustAnchorStore,
} from "./organization-trust-anchor";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const ORG = "ORG-1779558156034";
const FULL_FINGERPRINT = "A".repeat(64);

/** A join package in the exact wire form `parseOrganizationJoinPackage` accepts. */
function joinPackage(
  overrides: { fingerprint?: string; expiresAt?: Date; peer?: string } = {},
): string {
  // The real wire format: version header, `intended_hostname`, and a unix-seconds
  // expiry. Built to the parser's contract so these tests exercise it, not a mock.
  const expires = overrides.expiresAt ?? new Date("2026-08-26T00:10:00.000Z");
  return [
    "DPF_ORGANIZATION_JOIN_V2",
    `package_id=${"a".repeat(32)}`,
    "ca_url=https://ca.example.internal/",
    `root_fingerprint=${overrides.fingerprint ?? FULL_FINGERPRINT}`,
    `intended_hostname=${overrides.peer ?? "dpf-dev-01"}`,
    "intended_sans=dpf-dev-01",
    `expires_at=${Math.floor(expires.getTime() / 1000)}`,
    "enrollment_token=tok_abc123",
    "edge_client_enrollment_token=tok_edge456",
  ].join("\n");
}

function store(overrides: Partial<OrganizationTrustAnchorStore> = {}): OrganizationTrustAnchorStore {
  const record: JoinImportRecord = {
    parameters: { joinPackageEnc: "enc:stored" },
    completedAt: new Date("2026-08-20T00:00:00.000Z"),
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
  };
  return {
    findLatestCompletedJoinImport: async () => record,
    findLocalOrganizationRef: async () => ORG,
    ...overrides,
  };
}

const decryptTo = (plaintext: string) => () => plaintext;

describe("resolveOrganizationTrustAnchor", () => {
  it("resolves the FULL fingerprint from the package, not a truncated prefix", async () => {
    const result = await resolveOrganizationTrustAnchor(store(), {
      decrypt: decryptTo(joinPackage()),
      now: NOW,
    });
    expect(result.established).toBe(true);
    expect(result.anchor).toEqual({ rootFingerprint: FULL_FINGERPRINT, organizationRef: ORG });
    // A 12-character prefix is not an identity; comparing prefixes would be the
    // weakness this module exists to avoid.
    expect(result.anchor.rootFingerprint).toHaveLength(64);
  });

  it("never imports the credential store — decryption is injected", async () => {
    const decrypt = vi.fn(() => joinPackage());
    await resolveOrganizationTrustAnchor(store(), { decrypt, now: NOW });
    expect(decrypt).toHaveBeenCalledWith("enc:stored");
  });
});

describe("every unreadable path fails closed to no anchor", () => {
  async function expectAbsent(
    overrides: Partial<OrganizationTrustAnchorStore>,
    decrypt: (stored: string) => string | null,
    reason: string,
  ) {
    const result = await resolveOrganizationTrustAnchor(store(overrides), { decrypt, now: NOW });
    expect(result.established).toBe(false);
    expect(result.anchor).toEqual({ rootFingerprint: null, organizationRef: null });
    if (!result.established) expect(result.reason).toBe(reason);
  }

  it("reports no anchor when no join import exists", async () => {
    await expectAbsent(
      { findLatestCompletedJoinImport: async () => null },
      decryptTo(joinPackage()),
      "no-join-import",
    );
  });

  it("reports no anchor when the import lookup throws", async () => {
    await expectAbsent(
      {
        findLatestCompletedJoinImport: async () => {
          throw new Error("db down");
        },
      },
      decryptTo(joinPackage()),
      "no-join-import",
    );
  });

  it("reports no anchor when the record carries no encrypted package", async () => {
    await expectAbsent(
      {
        findLatestCompletedJoinImport: async () => ({
          parameters: {},
          completedAt: NOW,
          createdAt: NOW,
        }),
      },
      decryptTo(joinPackage()),
      "package-not-decryptable",
    );
  });

  it("reports no anchor when decryption returns null (rotated key)", async () => {
    await expectAbsent({}, () => null, "package-not-decryptable");
  });

  it("reports no anchor when decryption throws", async () => {
    await expectAbsent(
      {},
      () => {
        throw new Error("no encryption key");
      },
      "package-not-decryptable",
    );
  });

  it("reports no anchor when the package does not parse", async () => {
    await expectAbsent({}, decryptTo("not-a-join-package"), "package-unparseable");
  });

  it("reports no anchor when the package has expired", async () => {
    // A membership window that has closed is not trust.
    await expectAbsent(
      {},
      decryptTo(joinPackage({ expiresAt: new Date("2026-08-25T00:00:00.000Z") })),
      "package-expired",
    );
  });

  it("reports no anchor when the installation has no organization", async () => {
    await expectAbsent(
      { findLocalOrganizationRef: async () => null },
      decryptTo(joinPackage()),
      "no-local-organization",
    );
  });

  it("reports no anchor when the organization lookup throws", async () => {
    await expectAbsent(
      {
        findLocalOrganizationRef: async () => {
          throw new Error("db down");
        },
      },
      decryptTo(joinPackage()),
      "no-local-organization",
    );
  });
});

describe("the absent anchor keeps enrolment honest", () => {
  it("produces exactly the shape that yields organization-trust-not-configured", async () => {
    // `evaluateOrganizationEnrollment` refuses on a null rootFingerprint, so an
    // unreadable anchor costs a human confirmation rather than widening trust.
    const result = await resolveOrganizationTrustAnchor(
      store({ findLatestCompletedJoinImport: async () => null }),
      { decrypt: decryptTo(joinPackage()), now: NOW },
    );
    expect(result.anchor.rootFingerprint).toBeNull();
  });
});
