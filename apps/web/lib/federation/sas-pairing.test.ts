import { describe, expect, it } from "vitest";

import {
  buildSasCommitmentStatement,
  computeCommitment,
  deriveSas,
  deriveSharedSecret,
  generateEphemeralKeypair,
  generatePairingNonce,
  sasEquals,
  verifyCommitment,
  type SasTranscript,
} from "./sas-pairing";
import {
  deriveDeviceId,
  generateInstanceSigningKeypair,
  signIdentityStatement,
  verifyIdentityStatement,
} from "./instance-identity";

// A minimal honest party in a pairing session.
function party(deviceId: string) {
  const keypair = generateEphemeralKeypair();
  const nonce = generatePairingNonce();
  return {
    deviceId,
    keypair,
    nonce,
    commitment: computeCommitment(keypair.publicKey, nonce),
  };
}

describe("commitment", () => {
  it("verifies a faithful reveal and rejects a tampered one", () => {
    const p = party("did_" + "a".repeat(64));
    expect(verifyCommitment(p.keypair.publicKey, p.nonce, p.commitment)).toBe(true);
    // Tampered public key (a MITM swapping keys after committing) is rejected.
    const other = generateEphemeralKeypair();
    expect(verifyCommitment(other.publicKey, p.nonce, p.commitment)).toBe(false);
    // Tampered nonce is rejected.
    expect(verifyCommitment(p.keypair.publicKey, generatePairingNonce(), p.commitment)).toBe(false);
  });
});

describe("identity-bound commitment transcript", () => {
  it("binds the commitment to the device, peer, pairing context, and authority URL", () => {
    const identity = generateInstanceSigningKeypair();
    const deviceId = deriveDeviceId(identity.signingPublicKey);
    const statement = buildSasCommitmentStatement({
      deviceId,
      peerBinding: "did_" + "b".repeat(64),
      authorityUrl: "https://dpf-a.local:3443",
      pairingContext: "rotating-discovery-id",
      commitment: "a".repeat(64),
    });
    const signature = signIdentityStatement(identity.signingPrivateKey, statement);

    expect(verifyIdentityStatement(identity.signingPublicKey, statement, signature)).toBe(true);
    expect(verifyIdentityStatement(
      identity.signingPublicKey,
      statement.replace("rotating-discovery-id", "attacker-context"),
      signature,
    )).toBe(false);
  });
});

describe("deriveSharedSecret", () => {
  it("is symmetric (X25519)", () => {
    const a = generateEphemeralKeypair();
    const b = generateEphemeralKeypair();
    const ab = deriveSharedSecret(a.privateKey, b.publicKey);
    const ba = deriveSharedSecret(b.privateKey, a.publicKey);
    expect(ab.equals(ba)).toBe(true);
  });
});

describe("deriveSas — honest pairing", () => {
  it("both sides compute the SAME 6-digit code", () => {
    const a = party("did_" + "a".repeat(64));
    const b = party("did_" + "b".repeat(64));

    // Each verifies the other's commitment before deriving anything.
    expect(verifyCommitment(b.keypair.publicKey, b.nonce, b.commitment)).toBe(true);
    expect(verifyCommitment(a.keypair.publicKey, a.nonce, a.commitment)).toBe(true);

    const secretA = deriveSharedSecret(a.keypair.privateKey, b.keypair.publicKey);
    const secretB = deriveSharedSecret(b.keypair.privateKey, a.keypair.publicKey);

    const sasA = deriveSas({
      localDeviceId: a.deviceId,
      remoteDeviceId: b.deviceId,
      localEphemeralPublicKey: a.keypair.publicKey,
      remoteEphemeralPublicKey: b.keypair.publicKey,
      localNonce: a.nonce,
      remoteNonce: b.nonce,
      sharedSecret: secretA,
    });
    const sasB = deriveSas({
      localDeviceId: b.deviceId,
      remoteDeviceId: a.deviceId,
      localEphemeralPublicKey: b.keypair.publicKey,
      remoteEphemeralPublicKey: a.keypair.publicKey,
      localNonce: b.nonce,
      remoteNonce: a.nonce,
      sharedSecret: secretB,
    });

    expect(sasA).toMatch(/^\d{6}$/);
    expect(sasA).toBe(sasB);
    expect(sasEquals(sasA, sasB)).toBe(true);
  });
});

describe("deriveSas — MITM detection (the whole point)", () => {
  it("an in-the-middle attacker yields DIFFERENT SAS on each honest side", () => {
    const a = party("did_" + "a".repeat(64));
    const b = party("did_" + "b".repeat(64));
    // Attacker M runs a distinct ephemeral keypair against each honest side.
    const mForA = generateEphemeralKeypair();
    const mForB = generateEphemeralKeypair();

    // A believes it paired with B, but actually shares a secret with M.
    const secretA = deriveSharedSecret(a.keypair.privateKey, mForA.publicKey);
    const sasA = deriveSas({
      localDeviceId: a.deviceId,
      remoteDeviceId: b.deviceId, // M forwards B's real device id
      localEphemeralPublicKey: a.keypair.publicKey,
      remoteEphemeralPublicKey: mForA.publicKey, // but M's key, not B's
      localNonce: a.nonce,
      remoteNonce: b.nonce,
      sharedSecret: secretA,
    });

    // B believes it paired with A, but actually shares a secret with M.
    const secretB = deriveSharedSecret(b.keypair.privateKey, mForB.publicKey);
    const sasB = deriveSas({
      localDeviceId: b.deviceId,
      remoteDeviceId: a.deviceId,
      localEphemeralPublicKey: b.keypair.publicKey,
      remoteEphemeralPublicKey: mForB.publicKey,
      localNonce: b.nonce,
      remoteNonce: a.nonce,
      sharedSecret: secretB,
    });

    // The operators comparing the two screens see different codes → they abort.
    expect(sasA).not.toBe(sasB);
  });
});

describe("deriveSas — determinism", () => {
  it("is stable for a fixed transcript", () => {
    const t: SasTranscript = {
      localDeviceId: "did_" + "a".repeat(64),
      remoteDeviceId: "did_" + "b".repeat(64),
      localEphemeralPublicKey: "PUBA",
      remoteEphemeralPublicKey: "PUBB",
      localNonce: "NA",
      remoteNonce: "NB",
      sharedSecret: Buffer.from("shared-secret-bytes"),
    };
    // Same inputs → same SAS regardless of which side labels itself "local".
    const swapped: SasTranscript = {
      localDeviceId: t.remoteDeviceId,
      remoteDeviceId: t.localDeviceId,
      localEphemeralPublicKey: t.remoteEphemeralPublicKey,
      remoteEphemeralPublicKey: t.localEphemeralPublicKey,
      localNonce: t.remoteNonce,
      remoteNonce: t.localNonce,
      sharedSecret: t.sharedSecret,
    };
    expect(deriveSas(t)).toBe(deriveSas(swapped));
  });
});
