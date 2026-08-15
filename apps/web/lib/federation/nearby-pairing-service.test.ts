import { describe, expect, it, vi } from "vitest";

import {
  deriveDeviceId,
  generateInstanceSigningKeypair,
  signIdentityStatement,
} from "./instance-identity";
import {
  buildSasCommitmentStatement,
  computeCommitment,
  generateEphemeralKeypair,
  generatePairingNonce,
} from "./sas-pairing";

import {
  approveIncomingNearbyPairing,
  createIncomingNearbyPairing,
  confirmIncomingNearbyPairing,
  denyIncomingNearbyPairing,
  pollIncomingNearbyPairing,
  revealIncomingNearbyPairing,
} from "./nearby-pairing-service";

const now = new Date("2026-07-20T12:00:00.000Z");
const requesterIdentity = generateInstanceSigningKeypair();
const requesterDeviceId = deriveDeviceId(requesterIdentity.signingPublicKey);
const requesterEphemeral = generateEphemeralKeypair();
const requesterNonce = generatePairingNonce();
const requesterCommitment = computeCommitment(requesterEphemeral.publicKey, requesterNonce);
const requestBase = {
  requesterAuthorityUrl: "https://dpf-a.local:3443",
  displayName: "Mac development installation",
  requesterInstallationId: `inst_${"a".repeat(32)}`,
  candidateDiscoveryId: "rotating-b-123456",
  requesterDeviceId,
  requesterSigningPublicKey: requesterIdentity.signingPublicKey,
  requesterCommitment,
};
const request = {
  ...requestBase,
  requesterCommitmentSignature: signIdentityStatement(
    requesterIdentity.signingPrivateKey,
    buildSasCommitmentStatement({
      deviceId: requesterDeviceId,
      peerBinding: requestBase.candidateDiscoveryId,
      authorityUrl: requestBase.requesterAuthorityUrl,
      pairingContext: requestBase.candidateDiscoveryId,
      commitment: requesterCommitment,
    }),
  ),
};
const receiverIdentity = generateInstanceSigningKeypair();
const localSigningIdentity = {
  installationId: `inst_${"b".repeat(32)}`,
  projectionSecret: "c".repeat(64),
  deviceId: deriveDeviceId(receiverIdentity.signingPublicKey),
  signingPublicKey: receiverIdentity.signingPublicKey,
  signingPrivateKey: receiverIdentity.signingPrivateKey,
};

describe("nearby pairing persistence service", () => {
  it("stores only the incoming secret hash and returns plaintext once", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "row_1",
      ...data,
    }));
    const result = await createIncomingNearbyPairing(request, {
      db: { federationPairingSession: { create } },
      now,
      pairingId: "pair_test123",
      randomBytes: () => Buffer.alloc(32, 7),
      localDisplayName: "Windows development installation",
      localInstallationId: `inst_${"b".repeat(32)}`,
      localAuthorityUrl: "https://dpf-b.local:3443",
      localSigningIdentity,
      encryptSecret: (value) => `enc:${value}`,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pairingId: "pair_test123",
        direction: "incoming",
        status: "pending",
        pairingSecretHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        peerInstallationId: request.requesterInstallationId,
        sasState: expect.objectContaining({
          protocolVersion: 1,
          remoteDeviceId: requesterDeviceId,
          remoteCommitment: requesterCommitment,
        }),
        expiresAt: new Date("2026-07-20T12:15:00.000Z"),
      }),
    });
    expect(create.mock.calls[0]?.[0].data).not.toHaveProperty("pairingSecretEnc");
    expect(result).toMatchObject({
      ok: true,
      pairingId: "pair_test123",
      pairingSecret: expect.stringMatching(/^dpffpair_/),
      peerDisplayName: "Windows development installation",
      peerInstallationId: `inst_${"b".repeat(32)}`,
      receiverDeviceId: localSigningIdentity.deviceId,
      receiverCommitment: expect.stringMatching(/^[a-f0-9]{64}$/),
      receiverCommitmentSignature: expect.any(String),
    });
  });

  it("verifies the committed requester reveal and derives the same six-digit SAS", async () => {
    let stored: Record<string, unknown> = {};
    const created = await createIncomingNearbyPairing(request, {
      db: {
        federationPairingSession: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            stored = data;
            return data;
          }),
        },
      },
      now,
      pairingId: "pair_sas123",
      randomBytes: () => Buffer.alloc(32, 8),
      localDisplayName: "Windows development installation",
      localInstallationId: `inst_${"b".repeat(32)}`,
      localAuthorityUrl: "https://dpf-b.local:3443",
      localSigningIdentity,
      encryptSecret: (value) => `enc:${value}`,
    });
    const update = vi.fn(async () => ({}));
    const revealed = await revealIncomingNearbyPairing(
      {
        pairingId: created.pairingId,
        pairingSecret: created.pairingSecret,
        requesterEphemeralPublicKey: requesterEphemeral.publicKey,
        requesterNonce,
      },
      {
        db: ({
          federationPairingSession: {
            findUnique: vi.fn(async () => ({ id: "row_1", ...stored })),
            update,
          },
        } as unknown) as NonNullable<Parameters<typeof revealIncomingNearbyPairing>[1]>["db"],
        now,
        decryptSecret: (value) => value.replace(/^enc:/, ""),
      },
    );

    expect(revealed).toMatchObject({
      ok: true,
      matchingCode: expect.stringMatching(/^\d{6}$/),
      receiverEphemeralPublicKey: expect.any(String),
      receiverNonce: expect.any(String),
    });
    if (!revealed.ok) throw new Error("expected reveal success");
    const expected = (await import("./sas-pairing")).deriveSas({
      localDeviceId: requesterDeviceId,
      remoteDeviceId: localSigningIdentity.deviceId,
      localEphemeralPublicKey: requesterEphemeral.publicKey,
      remoteEphemeralPublicKey: revealed.receiverEphemeralPublicKey,
      localNonce: requesterNonce,
      remoteNonce: revealed.receiverNonce,
      sharedSecret: (await import("./sas-pairing")).deriveSharedSecret(
        requesterEphemeral.privateKey,
        revealed.receiverEphemeralPublicKey,
      ),
    });
    expect(revealed.matchingCode).toBe(expected);
    expect(update).toHaveBeenCalledWith({
      where: { id: "row_1" },
      data: expect.objectContaining({
        matchingCode: expected,
        sasState: expect.objectContaining({
          localEphemeralPrivateKeyEnc: null,
          localNonceEnc: null,
          remoteEphemeralPublicKey: requesterEphemeral.publicKey,
          remoteNonce: requesterNonce,
        }),
      }),
    });
  });

  it("approves once by minting the existing bootstrap authority inside one transaction", async () => {
    const row: {
      id: string;
      pairingId: string;
      direction: string;
      status: string;
      matchingCode: string;
      pairingSecretHash: string;
      sasConfirmedAtLocal: Date | null;
      sasConfirmedAtPeer: Date | null;
      approvedByPrincipalId: string | null;
      relationshipPreset: string;
      offeredRole: string;
      expiresAt: Date;
    } = {
      id: "row_1",
      pairingId: "pair_test123",
      direction: "incoming",
      status: "pending",
      matchingCode: "123456",
      pairingSecretHash: "d".repeat(64),
      sasConfirmedAtLocal: null,
      sasConfirmedAtPeer: now,
      approvedByPrincipalId: null,
      relationshipPreset: "channel",
      offeredRole: "channel-upstream",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    };
    const tx = {
      federationPairingSession: {
        findUnique: vi.fn(async () => row),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({ ...row, status: "approved" })),
      },
      federationBootstrapToken: {
        create: vi.fn(async () => ({ id: "boot_1" })),
      },
    };
    const db = {
      async $transaction<T>(fn: (client: typeof tx) => Promise<T>): Promise<T> {
        return fn(tx);
      },
    };

    await expect(
      approveIncomingNearbyPairing(
        { pairingId: "pair_test123", approverPrincipalId: "principal_1" },
        {
          db,
          now,
          encryptSecret: (value) => `enc:${value}`,
          bootstrapMaterial: {
            plaintext: `dpffboot_${"A".repeat(39)}`,
            hash: "c".repeat(64),
            prefix: "dpffboot_AAA",
          },
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: "approved" });

    expect(tx.federationBootstrapToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: "c".repeat(64),
        offeredRole: "channel-upstream",
        proposedProjection: expect.objectContaining({ retentionClass: "standard" }),
        issuedByPrincipalId: "principal_1",
      }),
    });
    expect(tx.federationPairingSession.update).toHaveBeenCalledWith({
      where: { id: "row_1" },
      data: expect.objectContaining({
        status: "approved",
        bootstrapTokenId: "boot_1",
        bootstrapTokenEnc: expect.stringMatching(/^enc:dpffboot_/),
      }),
    });
  });

  it("does not mint invitation authority until both operators confirm the same SAS", async () => {
    const secret = `dpffpair_${"a".repeat(43)}`;
    const { createHash } = await import("node:crypto");
    const row: {
      id: string;
      pairingId: string;
      direction: string;
      status: string;
      matchingCode: string;
      pairingSecretHash: string;
      sasConfirmedAtLocal: Date | null;
      sasConfirmedAtPeer: Date | null;
      approvedByPrincipalId: string | null;
      relationshipPreset: string;
      offeredRole: string;
      expiresAt: Date;
    } = {
      id: "row_1",
      pairingId: "pair_test123",
      direction: "incoming",
      status: "pending",
      matchingCode: "123456",
      pairingSecretHash: createHash("sha256").update(secret).digest("hex"),
      sasConfirmedAtLocal: null,
      sasConfirmedAtPeer: null,
      approvedByPrincipalId: null,
      relationshipPreset: "same-organization",
      offeredRole: "same-org-peer",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    };
    const tx = {
      federationPairingSession: {
        findUnique: vi.fn(async () => row),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => row),
      },
      federationBootstrapToken: { create: vi.fn(async () => ({ id: "boot_1" })) },
    };
    const db = { async $transaction<T>(fn: (client: typeof tx) => Promise<T>) { return fn(tx); } };

    await expect(approveIncomingNearbyPairing(
      { pairingId: row.pairingId, approverPrincipalId: "principal_1" },
      { db, now },
    )).resolves.toEqual({ ok: true, status: "pending-confirmation" });
    expect(tx.federationBootstrapToken.create).not.toHaveBeenCalled();

    const locallyConfirmed = {
      ...row,
      sasConfirmedAtLocal: now,
      approvedByPrincipalId: "principal_1",
    };
    tx.federationPairingSession.findUnique.mockResolvedValueOnce(locallyConfirmed);
    await expect(confirmIncomingNearbyPairing(
      { pairingId: row.pairingId, pairingSecret: secret },
      {
        db,
        now,
        encryptSecret: (value) => `enc:${value}`,
        bootstrapMaterial: {
          plaintext: `dpffboot_${"A".repeat(39)}`,
          hash: "c".repeat(64),
          prefix: "dpffboot_AAA",
        },
      },
    )).resolves.toEqual({ ok: true, status: "approved" });
    expect(tx.federationBootstrapToken.create).toHaveBeenCalledTimes(1);
  });

  it("polls with the high-entropy secret and never authorizes with the matching code", async () => {
    const secret = `dpffpair_${"a".repeat(43)}`;
    const { createHash } = await import("node:crypto");
    const row = {
      id: "row_1",
      pairingId: "pair_test123",
      direction: "incoming",
      status: "approved",
      pairingSecretHash: createHash("sha256").update(secret).digest("hex"),
      bootstrapTokenEnc: "enc:bootstrap",
      matchingCode: "123456",
      expiresAt: new Date("2026-07-20T12:15:00.000Z"),
      bootstrapToken: { consumedAt: null, revokedAt: null, expiresAt: new Date("2026-07-20T12:15:00.000Z") },
    };
    const update = vi.fn(async () => row);
    const db = {
      federationPairingSession: {
        findUnique: vi.fn(async () => row),
        update,
      },
    };

    await expect(
      pollIncomingNearbyPairing(
        { pairingId: row.pairingId, pairingSecret: row.matchingCode },
        { db, now, decryptSecret: () => "dpffboot_wrong" },
      ),
    ).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(
      pollIncomingNearbyPairing(
        { pairingId: row.pairingId, pairingSecret: secret },
        { db, now, decryptSecret: () => `dpffboot_${"B".repeat(39)}` },
      ),
    ).resolves.toMatchObject({ ok: true, status: "approved", bootstrapToken: expect.stringMatching(/^dpffboot_/) });
    expect(update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: expect.objectContaining({ deliveredAt: now, lastPolledAt: now, pollCount: { increment: 1 } }),
    });
  });

  it("records an operator denial without minting invitation authority", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const db = { federationPairingSession: { updateMany } };
    await expect(
      denyIncomingNearbyPairing(
        {
          pairingId: "pair_test123",
          deniedByPrincipalId: "principal_1",
          reason: "Not one of our installations",
        },
        { db, now },
      ),
    ).resolves.toEqual({ ok: true, status: "denied" });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        pairingId: "pair_test123",
        direction: "incoming",
        status: "pending",
        expiresAt: { gt: now },
      },
      data: expect.objectContaining({
        status: "denied",
        deniedAt: now,
        deniedByPrincipalId: "principal_1",
        denialReason: "Not one of our installations",
        bootstrapTokenEnc: null,
      }),
    });
  });
});
