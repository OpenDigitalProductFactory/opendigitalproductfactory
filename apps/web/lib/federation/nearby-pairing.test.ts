import { describe, expect, it, vi } from "vitest";

import {
  createNearbyPairingMaterial,
  confirmNearbyPairingPeer,
  parseNearbyPairingRequest,
  pairingSecretMatches,
  pollNearbyPairingPeer,
  requestNearbyPairing,
  summarizeNearbyPairingProjection,
} from "./nearby-pairing";
import {
  deriveDeviceId,
  generateInstanceSigningKeypair,
  signIdentityStatement,
} from "./instance-identity";
import {
  buildSasCommitmentStatement,
  computeCommitment,
  deriveSas,
  deriveSharedSecret,
  generateEphemeralKeypair,
  generatePairingNonce,
} from "./sas-pairing";

const requesterKeypair = generateInstanceSigningKeypair();
const requesterIdentity = {
  installationId: `inst_${"a".repeat(32)}`,
  projectionSecret: "a".repeat(64),
  deviceId: deriveDeviceId(requesterKeypair.signingPublicKey),
  signingPublicKey: requesterKeypair.signingPublicKey,
  signingPrivateKey: requesterKeypair.signingPrivateKey,
};

function validParsedRequest(overrides: Record<string, unknown> = {}) {
  const ephemeral = generateEphemeralKeypair();
  const nonce = generatePairingNonce();
  const commitment = computeCommitment(ephemeral.publicKey, nonce);
  const candidateDiscoveryId = "rotating-b-123456";
  const requesterAuthorityUrl = "https://dpf-a.local";
  return {
    requesterAuthorityUrl,
    displayName: "Mac development installation",
    requesterInstallationId: requesterIdentity.installationId,
    candidateDiscoveryId,
    requesterDeviceId: requesterIdentity.deviceId,
    requesterSigningPublicKey: requesterIdentity.signingPublicKey,
    requesterCommitment: commitment,
    requesterCommitmentSignature: signIdentityStatement(
      requesterIdentity.signingPrivateKey,
      buildSasCommitmentStatement({
        deviceId: requesterIdentity.deviceId,
        peerBinding: candidateDiscoveryId,
        authorityUrl: requesterAuthorityUrl,
        pairingContext: candidateDiscoveryId,
        commitment,
      }),
    ),
    ...overrides,
  };
}

describe("nearby federation pairing contract", () => {
  it("creates a high-entropy bearer secret for the SAS session", () => {
    const material = createNearbyPairingMaterial({
      randomBytes: () => Buffer.from(Array.from({ length: 32 }, (_, index) => index)),
    });

    expect(material.plaintextSecret).toMatch(/^dpffpair_[A-Za-z0-9_-]{40,}$/);
    expect(material.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pairingSecretMatches(material.plaintextSecret, material.secretHash)).toBe(true);
    expect(pairingSecretMatches(`${material.plaintextSecret}x`, material.secretHash)).toBe(false);
  });

  it("accepts only bounded same-organization requests with link-local HTTPS authorities", () => {
    const valid = validParsedRequest();
    expect(parseNearbyPairingRequest(valid)).toEqual({
      ...valid,
      relationshipPreset: "same-organization",
    });

    expect(() =>
      parseNearbyPairingRequest(validParsedRequest({ requesterAuthorityUrl: "http://dpf-a.local" })),
    ).toThrow(/certificate-valid HTTPS/i);
    expect(() =>
      parseNearbyPairingRequest(validParsedRequest({ requesterAuthorityUrl: "https://example.com" })),
    ).toThrow(/nearby private or local endpoint/i);
    for (const requesterAuthorityUrl of [
      "https://dpf-a.local/connect/pair",
      "https://operator:secret@dpf-a.local",
      "https://dpf-a.local?mode=pair",
      "https://dpf-a.local#pair",
    ]) {
      expect(() =>
        parseNearbyPairingRequest(validParsedRequest({ requesterAuthorityUrl })),
      ).toThrow(/authority URL must be an origin/i);
    }
    expect(() =>
      parseNearbyPairingRequest(validParsedRequest({ displayName: "x".repeat(121) })),
    ).toThrow(/display name/i);
    expect(() =>
      parseNearbyPairingRequest(validParsedRequest({ requesterInstallationId: "inst_not-valid" })),
    ).toThrow(/installation ID/i);
    expect(() =>
      parseNearbyPairingRequest(validParsedRequest({ backlogItem: { title: "must never cross" } })),
    ).toThrow(/unknown pairing field/i);
    expect(() => parseNearbyPairingRequest(validParsedRequest({
      requesterDeviceId: `did_${"f".repeat(64)}`,
    }))).toThrow(/does not match/i);
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
    const receiverKeypair = generateInstanceSigningKeypair();
    const receiverDeviceId = deriveDeviceId(receiverKeypair.signingPublicKey);
    const receiverEphemeral = generateEphemeralKeypair();
    const receiverNonce = generatePairingNonce();
    const receiverCommitment = computeCommitment(receiverEphemeral.publicKey, receiverNonce);
    let requesterReveal: { requesterEphemeralPublicKey: string; requesterNonce: string } | null = null;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, string>;
      if (payload.operation === "request") {
        return new Response(JSON.stringify({
          ok: true,
          pairingId: "pair_123",
          pairingSecret: `dpffpair_${"a".repeat(43)}`,
          receiverDeviceId,
          receiverSigningPublicKey: receiverKeypair.signingPublicKey,
          receiverCommitment,
          receiverCommitmentSignature: signIdentityStatement(
            receiverKeypair.signingPrivateKey,
            buildSasCommitmentStatement({
              deviceId: receiverDeviceId,
              peerBinding: requesterIdentity.deviceId,
              authorityUrl: "https://dpf-b.local:3443",
              pairingContext: "pair_123",
              commitment: receiverCommitment,
            }),
          ),
          peerDisplayName: "Windows development installation",
          peerInstallationId: `inst_${"b".repeat(32)}`,
          expiresAt: "2026-07-20T12:15:00.000Z",
          projectionSummary: summarizeNearbyPairingProjection(),
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      requesterReveal = {
        requesterEphemeralPublicKey: payload.requesterEphemeralPublicKey,
        requesterNonce: payload.requesterNonce,
      };
      const matchingCode = deriveSas({
        localDeviceId: receiverDeviceId,
        remoteDeviceId: requesterIdentity.deviceId,
        localEphemeralPublicKey: receiverEphemeral.publicKey,
        remoteEphemeralPublicKey: payload.requesterEphemeralPublicKey,
        localNonce: receiverNonce,
        remoteNonce: payload.requesterNonce,
        sharedSecret: deriveSharedSecret(receiverEphemeral.privateKey, payload.requesterEphemeralPublicKey),
      });
      return new Response(JSON.stringify({
        ok: true,
        matchingCode,
        receiverEphemeralPublicKey: receiverEphemeral.publicKey,
        receiverNonce,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(
      requestNearbyPairing({
        candidateEndpoint: "https://dpf-b.local:3443",
        requesterAuthorityUrl: "https://dpf-a.local:3443",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
        requesterIdentity,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      ok: true,
      pairingId: "pair_123",
      matchingCode: expect.stringMatching(/^\d{6}$/),
      peerDeviceId: receiverDeviceId,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://dpf-b.local:3443/connect/pair",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    expect(requesterReveal).not.toBeNull();

    const invalidProjectionFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          pairingId: "pair_123",
          pairingSecret: `dpffpair_${"a".repeat(43)}`,
          receiverDeviceId,
          receiverSigningPublicKey: receiverKeypair.signingPublicKey,
          receiverCommitment,
          receiverCommitmentSignature: "invalid",
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
        requesterIdentity,
        fetchImpl: invalidProjectionFetch,
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
        requesterIdentity,
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

  it("confirms the displayed SAS with the high-entropy session secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, status: "pending-confirmation" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(confirmNearbyPairingPeer({
      candidateEndpoint: "https://dpf-b.local:3443",
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
      fetchImpl,
    })).resolves.toEqual({ ok: true, status: "pending-confirmation" });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      operation: "confirm",
      pairingId: "pair_123",
    });
  });
});
