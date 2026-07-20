import { describe, expect, it, vi } from "vitest";

import {
  approveIncomingNearbyPairing,
  createIncomingNearbyPairing,
  denyIncomingNearbyPairing,
  pollIncomingNearbyPairing,
} from "./nearby-pairing-service";

const now = new Date("2026-07-20T12:00:00.000Z");
const request = {
  requesterAuthorityUrl: "https://dpf-a.local:3443",
  displayName: "Arcamanus Mac",
  requesterInstallationId: `inst_${"a".repeat(32)}`,
  candidateDiscoveryId: "rotating-b-123456",
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
      localDisplayName: "Arcamanus Windows",
      localInstallationId: `inst_${"b".repeat(32)}`,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pairingId: "pair_test123",
        direction: "incoming",
        status: "pending",
        pairingSecretHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        peerInstallationId: request.requesterInstallationId,
        expiresAt: new Date("2026-07-20T12:15:00.000Z"),
      }),
    });
    expect(create.mock.calls[0]?.[0].data).not.toHaveProperty("pairingSecretEnc");
    expect(result).toMatchObject({
      ok: true,
      pairingId: "pair_test123",
      pairingSecret: expect.stringMatching(/^dpffpair_/),
      peerDisplayName: "Arcamanus Windows",
      peerInstallationId: `inst_${"b".repeat(32)}`,
    });
  });

  it("approves once by minting the existing bootstrap authority inside one transaction", async () => {
    const row = {
      id: "row_1",
      pairingId: "pair_test123",
      direction: "incoming",
      status: "pending",
      expiresAt: new Date("2026-07-20T12:15:00.000Z"),
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
        offeredRole: "same-org-peer",
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
      matchingCode: "ABCD-EFGH",
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
