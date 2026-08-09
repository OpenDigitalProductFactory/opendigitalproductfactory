import { describe, expect, it, vi } from "vitest";

import {
  deriveDemandNetworkRefs,
  resolveFederationIdentity,
  resolveFederationSigningIdentity,
  type FederationIdentityDb,
} from "./demand-identity";
import {
  DEVICE_ID_RE,
  deriveDeviceId,
  generateInstanceSigningKeypair,
} from "./instance-identity";

describe("resolveFederationIdentity", () => {
  it("reuses a persisted identity that already carries a keypair (no upgrade write)", async () => {
    const kp = generateInstanceSigningKeypair();
    const existing = {
      installationId: `inst_${"c".repeat(32)}`,
      projectionSecret: "a".repeat(64),
      deviceId: deriveDeviceId(kp.signingPublicKey),
      signingPublicKey: kp.signingPublicKey,
      signingPrivateKeyEnc: "enc:" + kp.signingPrivateKey,
    };
    const upsert = vi.fn().mockResolvedValue({ value: existing });
    const update = vi.fn();

    const identity = await resolveFederationIdentity(
      { platformConfig: { upsert, update } } as FederationIdentityDb,
    );

    // Returns the PUBLIC identity — never the encrypted private key.
    expect(identity).toEqual({
      installationId: existing.installationId,
      projectionSecret: existing.projectionSecret,
      deviceId: existing.deviceId,
      signingPublicKey: existing.signingPublicKey,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("upgrades a legacy identity (no keypair) by minting one exactly once", async () => {
    const legacy = {
      installationId: `inst_${"c".repeat(32)}`,
      projectionSecret: "a".repeat(64),
    };
    const upsert = vi.fn().mockResolvedValue({ value: legacy });
    const update = vi.fn().mockImplementation(async ({ data }: { data: { value: unknown } }) => ({
      value: data.value,
    }));

    const identity = await resolveFederationIdentity(
      { platformConfig: { upsert, update } } as FederationIdentityDb,
    );

    expect(identity.installationId).toBe(legacy.installationId);
    expect(identity.deviceId).toMatch(DEVICE_ID_RE);
    expect(identity.signingPublicKey).toBeTruthy();
    // Persisted the upgrade once, and stored the ENCRYPTED private key (never returned).
    expect(update).toHaveBeenCalledTimes(1);
    const persisted = update.mock.calls[0][0].data.value as Record<string, unknown>;
    expect(persisted.signingPrivateKeyEnc).toBeTruthy();
    expect(identity).not.toHaveProperty("signingPrivateKeyEnc");
  });

  it("creates opaque identity material with a keypair when the installation has none", async () => {
    const upsert = vi.fn().mockImplementation(async ({ create }: { create: { value: unknown } }) => ({
      value: create.value,
    }));
    const update = vi.fn();

    const identity = await resolveFederationIdentity(
      { platformConfig: { upsert, update } } as FederationIdentityDb,
    );

    expect(identity.installationId).toMatch(/^inst_[a-f0-9]{32}$/);
    expect(identity.projectionSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.deviceId).toMatch(DEVICE_ID_RE);
    expect(identity.signingPublicKey).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("resolveFederationSigningIdentity", () => {
  it("returns a validated private signing identity only through the guarded accessor", async () => {
    const kp = generateInstanceSigningKeypair();
    const existing = {
      installationId: `inst_${"c".repeat(32)}`,
      projectionSecret: "a".repeat(64),
      deviceId: deriveDeviceId(kp.signingPublicKey),
      signingPublicKey: kp.signingPublicKey,
      signingPrivateKeyEnc: "encrypted-private-key",
    };
    const db = {
      platformConfig: {
        upsert: vi.fn().mockResolvedValue({ value: existing }),
        update: vi.fn(),
      },
    } as FederationIdentityDb;

    await expect(resolveFederationSigningIdentity(db, {
      decryptSecret: () => kp.signingPrivateKey,
    })).resolves.toEqual({
      installationId: existing.installationId,
      projectionSecret: existing.projectionSecret,
      deviceId: existing.deviceId,
      signingPublicKey: existing.signingPublicKey,
      signingPrivateKey: kp.signingPrivateKey,
    });
  });

  it("fails closed when encrypted identity material does not match the public identity", async () => {
    const publicPair = generateInstanceSigningKeypair();
    const wrongPrivatePair = generateInstanceSigningKeypair();
    const existing = {
      installationId: `inst_${"c".repeat(32)}`,
      projectionSecret: "a".repeat(64),
      deviceId: deriveDeviceId(publicPair.signingPublicKey),
      signingPublicKey: publicPair.signingPublicKey,
      signingPrivateKeyEnc: "encrypted-private-key",
    };
    const db = {
      platformConfig: {
        upsert: vi.fn().mockResolvedValue({ value: existing }),
        update: vi.fn(),
      },
    } as FederationIdentityDb;

    await expect(resolveFederationSigningIdentity(db, {
      decryptSecret: () => wrongPrivatePair.signingPrivateKey,
    })).rejects.toThrow("does not match");
  });
});

describe("deriveDemandNetworkRefs", () => {
  it("is stable and does not expose the local backlog item ID", () => {
    const identity = { installationId: "inst_a", projectionSecret: "b".repeat(64) };

    const first = deriveDemandNetworkRefs(identity, "BI-PRIVATE-123");
    const second = deriveDemandNetworkRefs(identity, "BI-PRIVATE-123");

    expect(first).toEqual(second);
    expect(first.envelopeId).toMatch(/^dem_[a-f0-9]{32}$/);
    expect(first.originRecordRef).toMatch(/^ref_[a-f0-9]{32}$/);
    expect(JSON.stringify(first)).not.toContain("BI-PRIVATE-123");
  });
});
