import { describe, expect, it, vi } from "vitest";

import {
  createNearbyPairingMaterial,
  parseNearbyPairingRequest,
  pairingSecretMatches,
  pollNearbyPairingPeer,
  requestNearbyPairing,
  summarizeNearbyPairingProjection,
} from "./nearby-pairing";

describe("nearby federation pairing contract", () => {
  it("creates a high-entropy bearer secret and a separate readable matching code", () => {
    const material = createNearbyPairingMaterial({
      randomBytes: () => Buffer.from(Array.from({ length: 32 }, (_, index) => index)),
    });

    expect(material.plaintextSecret).toMatch(/^dpffpair_[A-Za-z0-9_-]{40,}$/);
    expect(material.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(material.matchingCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(material.matchingCode).not.toContain(material.plaintextSecret.slice(-8));
    expect(pairingSecretMatches(material.plaintextSecret, material.secretHash)).toBe(true);
    expect(pairingSecretMatches(`${material.plaintextSecret}x`, material.secretHash)).toBe(false);
  });

  it("accepts only bounded same-organization requests with link-local HTTPS authorities", () => {
    expect(
      parseNearbyPairingRequest({
        requesterAuthorityUrl: "https://dpf-a.local",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
      }),
    ).toEqual({
      requesterAuthorityUrl: "https://dpf-a.local",
      displayName: "Mac development installation",
      requesterInstallationId: `inst_${"a".repeat(32)}`,
      candidateDiscoveryId: "rotating-b-123456",
      relationshipPreset: "same-organization",
    });

    expect(() =>
      parseNearbyPairingRequest({
        requesterAuthorityUrl: "http://dpf-a.local",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
      }),
    ).toThrow(/certificate-valid HTTPS/i);
    expect(() =>
      parseNearbyPairingRequest({
        requesterAuthorityUrl: "https://example.com",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
      }),
    ).toThrow(/nearby private or local endpoint/i);
    for (const requesterAuthorityUrl of [
      "https://dpf-a.local/connect/pair",
      "https://operator:secret@dpf-a.local",
      "https://dpf-a.local?mode=pair",
      "https://dpf-a.local#pair",
    ]) {
      expect(() =>
        parseNearbyPairingRequest({
          requesterAuthorityUrl,
          displayName: "Mac development installation",
          requesterInstallationId: `inst_${"a".repeat(32)}`,
          candidateDiscoveryId: "rotating-b-123456",
        }),
      ).toThrow(/authority URL must be an origin/i);
    }
    expect(() =>
      parseNearbyPairingRequest({
        requesterAuthorityUrl: "https://dpf-a.local",
        displayName: "x".repeat(121),
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
      }),
    ).toThrow(/display name/i);
    expect(() =>
      parseNearbyPairingRequest({
        requesterAuthorityUrl: "https://dpf-a.local",
        displayName: "Mac development installation",
        requesterInstallationId: "inst_not-valid",
        candidateDiscoveryId: "rotating-b-123456",
      }),
    ).toThrow(/installation ID/i);
    expect(() =>
      parseNearbyPairingRequest({
        requesterAuthorityUrl: "https://dpf-a.local",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
        backlogItem: { title: "must never cross" },
      }),
    ).toThrow(/unknown pairing field/i);
  });

  it("derives the operator summary from the canonical same-organization projection", () => {
    expect(summarizeNearbyPairingProjection()).toEqual({
      relationshipLabel: "Same organization",
      retentionClass: "standard",
      sharedSlices: ["demand"],
      staysLocal: [
        "local backlog details",
        "work capsules",
        "private planning",
        "attachments",
        "customer context",
      ],
    });
  });

  it("exchanges a pairing request only with a certificate-valid nearby HTTPS endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          pairingId: "pair_123",
          pairingSecret: `dpffpair_${"a".repeat(43)}`,
          matchingCode: "ABCD-EFGH",
          peerDisplayName: "Windows development installation",
          peerInstallationId: `inst_${"b".repeat(32)}`,
          expiresAt: "2026-07-20T12:15:00.000Z",
          projectionSummary: summarizeNearbyPairingProjection(),
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      requestNearbyPairing({
        candidateEndpoint: "https://dpf-b.local:3443",
        requesterAuthorityUrl: "https://dpf-a.local:3443",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ ok: true, pairingId: "pair_123", matchingCode: "ABCD-EFGH" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://dpf-b.local:3443/connect/pair",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );

    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          pairingId: "pair_123",
          pairingSecret: `dpffpair_${"a".repeat(43)}`,
          matchingCode: "ABCD-EFGH",
          peerDisplayName: "Windows development installation",
          peerInstallationId: `inst_${"b".repeat(32)}`,
          expiresAt: "2026-07-20T12:15:00.000Z",
          projectionSummary: {
            ...summarizeNearbyPairingProjection(),
            sharedSlices: ["backlog", "customer-context"],
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      requestNearbyPairing({
        candidateEndpoint: "https://dpf-b.local:3443",
        requesterAuthorityUrl: "https://dpf-a.local:3443",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ ok: false, error: "invalid_peer_response" });

    fetchImpl.mockClear();
    await expect(
      requestNearbyPairing({
        candidateEndpoint: "http://dpf-b.local:3000",
        requesterAuthorityUrl: "https://dpf-a.local:3443",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ ok: false, error: "tls_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("polls the same HTTPS pairing endpoint with the high-entropy secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, status: "approved", bootstrapToken: `dpffboot_${"A".repeat(39)}` }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      pollNearbyPairingPeer({
        candidateEndpoint: "https://dpf-b.local:3443",
        pairingId: "pair_123",
        pairingSecret: `dpffpair_${"a".repeat(43)}`,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ ok: true, status: "approved", bootstrapToken: expect.stringMatching(/^dpffboot_/) });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://dpf-b.local:3443/connect/pair",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
  });
});
