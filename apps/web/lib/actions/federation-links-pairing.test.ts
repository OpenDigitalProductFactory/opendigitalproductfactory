import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  resolveAppBaseUrl: vi.fn(),
  listCandidates: vi.fn(),
  resolveIdentity: vi.fn(),
  requestPairing: vi.fn(),
  pollPairing: vi.fn(),
  confirmPairing: vi.fn(),
  enrollWithPeer: vi.fn(),
  assertEncryption: vi.fn(),
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  findPrincipalAlias: vi.fn(),
  findOrganization: vi.fn(),
  findPairing: vi.fn(),
  findPairingById: vi.fn(),
  createPairing: vi.fn(),
  updatePairing: vi.fn(),
  updateIntroductionCandidates: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    principalAlias: { findFirst: mocks.findPrincipalAlias },
    organization: { findFirst: mocks.findOrganization },
    federationPairingSession: {
      findFirst: mocks.findPairing,
      findUnique: mocks.findPairingById,
      create: mocks.createPairing,
      update: mocks.updatePairing,
    },
    federationIntroductionCandidate: { updateMany: mocks.updateIntroductionCandidates },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@/lib/app-url", () => ({ resolveAppBaseUrl: mocks.resolveAppBaseUrl }));
vi.mock("@/lib/identity/principal-linking", () => ({ syncUserPrincipal: vi.fn() }));
vi.mock("@/lib/federation/demand-identity", () => ({
  resolveFederationSigningIdentity: mocks.resolveIdentity,
}));
vi.mock("@/lib/federation/nearby-candidates", () => ({
  listNearbyFederationCandidates: mocks.listCandidates,
}));
vi.mock("@/lib/federation/nearby-pairing", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/federation/nearby-pairing")>();
  return {
    ...original,
    requestNearbyPairing: mocks.requestPairing,
    pollNearbyPairingPeer: mocks.pollPairing,
    confirmNearbyPairingPeer: mocks.confirmPairing,
  };
});
vi.mock("@/lib/federation/nearby-pairing-service", () => ({
  approveIncomingNearbyPairing: vi.fn(),
  denyIncomingNearbyPairing: vi.fn(),
}));
vi.mock("@/lib/federation/outbound", () => ({
  enrollWithPeer: mocks.enrollWithPeer,
  relayApprovalToPeer: vi.fn(),
}));
vi.mock("@/lib/federation/enrollment", () => ({
  approveFederationLinkLocal: vi.fn(),
  issueFederationBootstrap: vi.fn(),
  quarantineFederationLink: vi.fn(),
  revokeFederationLink: vi.fn(),
}));
vi.mock("@/lib/govern/credential-crypto", () => ({
  assertEncryptionReadyForCredentialWrite: mocks.assertEncryption,
  encryptSecret: mocks.encryptSecret,
  decryptSecret: mocks.decryptSecret,
}));

import {
  confirmNearbyPairingAction,
  pollNearbyPairingAction,
  startNearbyPairingAction,
} from "./federation-links";

const candidate = {
  discoveryId: "rotating-peer-1234",
  endpoint: "https://peer.local:3443",
  protocol: "1" as const,
  capabilityDigest: "8f31c9a2",
  pairPath: "/connect/pair" as const,
  observedAt: "2026-07-20T12:00:00.000Z",
  expiresAt: "2026-07-20T12:02:00.000Z",
  automaticPairing: "tls-validation-required" as const,
};

describe("nearby federation pairing actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: "user_1", platformRole: "admin", isSuperuser: true },
    });
    mocks.findPrincipalAlias.mockResolvedValue({ principalId: "principal_1" });
    mocks.resolveAppBaseUrl.mockReturnValue("https://local-dpf.local:3443");
    mocks.listCandidates.mockReturnValue([candidate]);
    mocks.assertEncryption.mockResolvedValue(undefined);
    mocks.resolveIdentity.mockResolvedValue({
      installationId: `inst_${"a".repeat(32)}`,
      deviceId: `did_${"a".repeat(64)}`,
      signingPublicKey: "requester-public-key",
      signingPrivateKey: "requester-private-key",
    });
    mocks.findOrganization.mockResolvedValue({ id: "org_1", name: "Mac development installation" });
    mocks.findPairing.mockResolvedValue(null);
    mocks.encryptSecret.mockReturnValue("encrypted-pairing-secret");
    mocks.createPairing.mockResolvedValue({ id: "session_1" });
    mocks.updateIntroductionCandidates.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementation(async (run) => run({
      federationPairingSession: { update: mocks.updatePairing },
      federationIntroductionCandidate: { updateMany: mocks.updateIntroductionCandidates },
    }));
  });

  it("persists an encrypted outgoing session only for a currently discovered HTTPS peer", async () => {
    mocks.requestPairing.mockResolvedValue({
      ok: true,
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
      matchingCode: "123456",
      peerDisplayName: "Windows development installation",
      peerInstallationId: `inst_${"b".repeat(32)}`,
      peerDeviceId: `did_${"b".repeat(64)}`,
      peerSigningPublicKey: "receiver-public-key",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      projectionSummary: {
        relationshipLabel: "Same organization",
        retentionClass: "standard",
        sharedSlices: ["demand"],
        staysLocal: ["local backlog details"],
      },
    });

    await expect(startNearbyPairingAction({
      discoveryId: candidate.discoveryId,
      endpoint: candidate.endpoint,
    })).resolves.toMatchObject({ ok: true, pairingId: "pair_123", status: "pending" });

    expect(mocks.requestPairing).toHaveBeenCalledWith(expect.objectContaining({
      candidateEndpoint: candidate.endpoint,
      requesterAuthorityUrl: "https://local-dpf.local:3443",
      requesterInstallationId: `inst_${"a".repeat(32)}`,
      requesterIdentity: expect.objectContaining({ deviceId: `did_${"a".repeat(64)}` }),
    }));
    expect(mocks.createPairing).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "outgoing",
        pairingSecretEnc: "encrypted-pairing-secret",
        sasState: expect.objectContaining({
          localDeviceId: `did_${"a".repeat(64)}`,
          remoteDeviceId: `did_${"b".repeat(64)}`,
        }),
        peerAuthorityUrl: candidate.endpoint,
      }),
    });
    expect(mocks.createPairing.mock.calls[0]?.[0].data).not.toHaveProperty("pairingSecret");
  });

  it("reports the evidence verdict on a started pairing instead of leaving the operator to guess", async () => {
    mocks.requestPairing.mockResolvedValue({
      ok: true,
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
      matchingCode: "123456",
      peerDisplayName: "Windows development installation",
      peerInstallationId: `inst_${"b".repeat(32)}`,
      peerDeviceId: `did_${"b".repeat(64)}`,
      peerSigningPublicKey: "receiver-public-key",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      projectionSummary: {
        relationshipLabel: "Same organization",
        retentionClass: "standard",
        sharedSlices: ["demand"],
        staysLocal: ["local backlog details"],
      },
    });

    const result = await startNearbyPairingAction({
      discoveryId: candidate.discoveryId,
      endpoint: candidate.endpoint,
    });

    // No organization root is mounted and no join import exists here, so nothing
    // about this peer can be PROVEN. The pairing still proceeds to the SAS
    // exchange — that is the manual path, unchanged — but it now carries the
    // reason a human is being asked, rather than asking silently.
    expect(result).toMatchObject({
      ok: true,
      pairingMode: "operator-confirmation",
    });
    expect(result).toHaveProperty("pairingReason");
    expect(typeof (result as { pairingExplanation?: string }).pairingExplanation).toBe("string");
  });

  it("refuses a plain-HTTP peer with the decision's own words, not a hardcoded sentence", async () => {
    mocks.listCandidates.mockReturnValue([
      { ...candidate, endpoint: "http://peer.local:3000", automaticPairing: "blocked-insecure-transport" as const },
    ]);

    const result = await startNearbyPairingAction({
      discoveryId: candidate.discoveryId,
      endpoint: "http://peer.local:3000",
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_input" });
    // The wording now comes from `decideAutomaticPairing`, which explains that an
    // identity advertised over plain HTTP cannot be verified at all.
    expect((result as { message: string }).message).toContain("plain HTTP");
    expect((result as { message: string }).message).toContain("manual invitation");
    expect(mocks.requestPairing).not.toHaveBeenCalled();
  });

  it("redeems an approved peer invitation and clears the pairing credential", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    mocks.findPairingById.mockResolvedValue({
      id: "session_1",
      pairingId: "pair_123",
      direction: "outgoing",
      status: "pending",
      matchingCode: "123456",
      pairingSecretEnc: "encrypted-pairing-secret",
      peerDisplayName: "Windows development installation",
      peerAuthorityUrl: candidate.endpoint,
      peerInstallationId: `inst_${"b".repeat(32)}`,
      expiresAt,
    });
    mocks.decryptSecret.mockReturnValue(`dpffpair_${"a".repeat(43)}`);
    mocks.pollPairing.mockResolvedValue({
      ok: true,
      status: "approved",
      bootstrapToken: `dpffboot_${"A".repeat(39)}`,
    });
    mocks.enrollWithPeer.mockResolvedValue({
      ok: true,
      linkId: "FL-1",
      linkState: "pending",
      role: "same-org-peer",
    });
    mocks.updatePairing.mockResolvedValue({ id: "session_1" });

    await expect(pollNearbyPairingAction("pair_123")).resolves.toMatchObject({
      ok: true,
      status: "consumed",
      linkId: "FL-1",
    });
    expect(mocks.enrollWithPeer).toHaveBeenCalledWith(expect.objectContaining({
      bootstrapToken: `dpffboot_${"A".repeat(39)}`,
      peerAuthorityUrl: candidate.endpoint,
      localOrganizationId: "org_1",
    }));
    expect(mocks.updatePairing).toHaveBeenLastCalledWith({
      where: { id: "session_1" },
      data: expect.objectContaining({ status: "consumed", pairingSecretEnc: null }),
    });
    expect(mocks.updateIntroductionCandidates).toHaveBeenCalledWith({
      where: {
        OR: [{ installationId: `inst_${"b".repeat(32)}` }],
        pairedFederationLinkId: null,
      },
      data: { pairedFederationLinkId: "FL-1" },
    });
  });

  it("records outgoing SAS confirmation only after the peer accepts it", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    mocks.findPairingById.mockResolvedValue({
      id: "session_1",
      pairingId: "pair_123",
      direction: "outgoing",
      status: "pending",
      matchingCode: "123456",
      pairingSecretEnc: "encrypted-pairing-secret",
      peerDisplayName: "Windows development installation",
      peerAuthorityUrl: candidate.endpoint,
      expiresAt,
    });
    mocks.decryptSecret.mockReturnValue(`dpffpair_${"a".repeat(43)}`);
    mocks.confirmPairing.mockResolvedValue({ ok: true, status: "pending-confirmation" });
    mocks.updatePairing.mockResolvedValue({ id: "session_1" });

    await expect(confirmNearbyPairingAction("pair_123")).resolves.toEqual({
      ok: true,
      status: "pending-confirmation",
    });
    expect(mocks.confirmPairing).toHaveBeenCalledWith(expect.objectContaining({
      candidateEndpoint: candidate.endpoint,
      pairingId: "pair_123",
    }));
    expect(mocks.updatePairing).toHaveBeenCalledWith({
      where: { id: "session_1" },
      data: { sasConfirmedAtLocal: expect.any(Date) },
    });
  });
});
