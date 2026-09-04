import { describe, expect, it } from "vitest";

import {
  pairingSupportsWorkSync,
  resolveInstallationPairing,
  type PairingLink,
} from "./installation-peer-pairing";

function link(overrides: Partial<PairingLink> = {}): PairingLink {
  return {
    linkId: "FL-0001",
    linkState: "trusted",
    relationshipPreset: "same-organization",
    peerLabel: "operator-production",
    ...overrides,
  };
}

describe("resolveInstallationPairing", () => {
  it("prefers a live link over what the operator typed", () => {
    const result = resolveInstallationPairing({
      declaredRef: "something-else",
      links: [link()],
    });
    expect(result).toMatchObject({
      ref: "operator-production",
      source: "federation-link",
      linkId: "FL-0001",
      declaredButUnconfirmed: true,
    });
  });

  it("does not flag a mismatch when the declaration agrees with the link", () => {
    const result = resolveInstallationPairing({
      declaredRef: "operator-production",
      links: [link()],
    });
    expect(result.declaredButUnconfirmed).toBe(false);
  });

  it("falls back to the declared value when no link exists", () => {
    const result = resolveInstallationPairing({
      declaredRef: "operator-production",
      links: [],
    });
    expect(result).toEqual({
      ref: "operator-production",
      source: "declared-intent",
      declaredButUnconfirmed: true,
    });
  });

  it("reports no pairing when nothing is declared and nothing is linked", () => {
    expect(resolveInstallationPairing({ links: [] })).toEqual({
      ref: null,
      source: "none",
      declaredButUnconfirmed: false,
    });
  });

  it("ignores a revoked link", () => {
    const result = resolveInstallationPairing({
      links: [link({ revokedAt: new Date("2026-08-01T00:00:00.000Z") })],
    });
    expect(result.source).toBe("none");
  });

  it("ignores a quarantined link", () => {
    const result = resolveInstallationPairing({
      links: [link({ quarantinedAt: new Date("2026-08-01T00:00:00.000Z") })],
    });
    expect(result.source).toBe("none");
  });

  it("ignores a link that is not yet approved", () => {
    expect(resolveInstallationPairing({ links: [link({ linkState: "pending" })] }).source).toBe(
      "none",
    );
  });

  it("counts only the trust state a link can actually hold (BI-D92A50F4)", () => {
    // `resolveLinkTrust` produces pending | trusted | quarantined | revoked and
    // nothing else. Any other spelling means the resolver can never match a real
    // row and work sync reports "nowhere to mirror" while mirroring succeeds.
    expect(resolveInstallationPairing({ links: [link({ linkState: "trusted" })] }).source).toBe(
      "federation-link",
    );
    for (const impossible of ["active", "approved", "quarantined", "revoked"]) {
      expect(resolveInstallationPairing({ links: [link({ linkState: impossible })] }).source).toBe(
        "none",
      );
    }
  });

  it("ignores cross-organization links — those are not a pairing", () => {
    for (const preset of ["service-provider", "channel", "community-peer"]) {
      const result = resolveInstallationPairing({ links: [link({ relationshipPreset: preset })] });
      expect(result.source).toBe("none");
    }
  });

  it("falls back to the link id when the link records no peer label", () => {
    const result = resolveInstallationPairing({ links: [link({ peerLabel: null })] });
    expect(result.ref).toBe("FL-0001");
  });

  it("picks deterministically when an organization has several peers", () => {
    const links = [link({ linkId: "FL-0003" }), link({ linkId: "FL-0001" })];
    expect(resolveInstallationPairing({ links }).linkId).toBe("FL-0001");
    expect(resolveInstallationPairing({ links: [...links].reverse() }).linkId).toBe("FL-0001");
  });

  it("treats blank declared text as no declaration", () => {
    expect(resolveInstallationPairing({ declaredRef: "   ", links: [] }).source).toBe("none");
  });
});

describe("pairingSupportsWorkSync", () => {
  it("allows mirroring only when a real link backs the pairing", () => {
    expect(pairingSupportsWorkSync(resolveInstallationPairing({ links: [link()] }))).toBe(true);
  });

  it("refuses to mirror to a name nobody established", () => {
    // The whole point: a typed peer gives nothing to send work to.
    expect(
      pairingSupportsWorkSync(
        resolveInstallationPairing({ declaredRef: "operator-production", links: [] }),
      ),
    ).toBe(false);
  });

  it("refuses when there is no pairing at all", () => {
    expect(pairingSupportsWorkSync(resolveInstallationPairing({ links: [] }))).toBe(false);
  });
});
