import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  resolveAppBaseUrl: vi.fn(),
  listCandidates: vi.fn(),
  resolveIdentity: vi.fn(),
  requestPairing: vi.fn(),
  pollPairing: vi.fn(),
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
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@dpf/db", () => ({
  prisma: {
    principalAlias: { findFirst: mocks.findPrincipalAlias },
    organization: { findFirst: mocks.findOrganization },
    federationPairingSession: {
      findFirst: mocks.findPairing,
      findUnique: mocks.findPairingById,
      create: mocks.createPairing,
      update: mocks.updatePairing,
    },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@/lib/app-url", () => ({ resolveAppBaseUrl: mocks.resolveAppBaseUrl }));
vi.mock("@/lib/identity/principal-linking", () => ({ syncUserPrincipal: vi.fn() }));
vi.mock("@/lib/federation/demand-identity", () => ({
  resolveFederationIdentity: mocks.resolveIdentity,
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
    mocks.resolveIdentity.mockResolvedValue({ installationId: `inst_${"a".repeat(32)}` });
    mocks.findOrganization.mockResolvedValue({ id: "org_1", name: "Arcamanus Mac" });
    mocks.findPairing.mockResolvedValue(null);
    mocks.encryptSecret.mockReturnValue("encrypted-pairing-secret");
    mocks.createPairing.mockResolvedValue({ id: "session_1" });
  });

  it("persists an encrypted outgoing session only for a currently discovered HTTPS peer", async () => {
    mocks.requestPairing.mockResolvedValue({
      ok: true,
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
      matchingCode: "ABCD-EFGH",
      peerDisplayName: "Arcamanus Windows",
      peerInstallationId: `inst_${"b".repeat(32)}`,
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
    }));
    expect(mocks.createPairing).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "outgoing",
        pairingSecretEnc: "encrypted-pairing-secret",
        peerAuthorityUrl: candidate.endpoint,
      }),
    });
    expect(mocks.createPairing.mock.calls[0]?.[0].data).not.toHaveProperty("pairingSecret");
  });

  it("redeems an approved peer invitation and clears the pairing credential", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    mocks.findPairingById.mockResolvedValue({
      id: "session_1",
      pairingId: "pair_123",
      direction: "outgoing",
      status: "pending",
      matchingCode: "ABCD-EFGH",
      pairingSecretEnc: "encrypted-pairing-secret",
      peerDisplayName: "Arcamanus Windows",
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
  });
});
