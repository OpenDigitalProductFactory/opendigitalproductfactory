// EP-DELIVERY-FLOW · BI-67315C4A increment 1 — federation instance identity.
//
// A DPF install's federation identity is a stable cryptographic device ID (the
// fingerprint of a long-lived Ed25519 signing keypair), NOT a typed URL and NOT
// the random-UUID installationId. Identity travels with the key, so an install's
// LAN address can change (or be reached via localhost) without breaking a link —
// the exact class of failure the original invite-token/paste-URL flow suffered.
//
// This is the foundation the robust pairing rests on: peers bind a FederationLink
// to the peer's deviceId, mDNS advertises it, and SAS pairing (a later increment)
// runs an ephemeral ECDH whose transcript is authenticated against these stable
// identity keys. Prior art: Syncthing device IDs (a hash of the device cert).
//
// Pure and Node-crypto only — no DB, no env — so it is exhaustively unit-testable.
// Persistence + key-at-rest encryption live in demand-identity.ts, which composes
// these functions and stores the private key via the existing credential-crypto.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

/** A device ID: `did_` + the lowercase hex SHA-256 of the SPKI-DER public key. */
export const DEVICE_ID_RE = /^did_[a-f0-9]{64}$/;

export interface InstanceSigningKeypair {
  /** Ed25519 public key, SPKI DER, base64. Safe to publish to peers. */
  signingPublicKey: string;
  /** Ed25519 private key, PKCS8 DER, base64. MUST be encrypted at rest. */
  signingPrivateKey: string;
}

/** Generate a fresh long-lived Ed25519 identity keypair for this installation. */
export function generateInstanceSigningKeypair(): InstanceSigningKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    signingPublicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    signingPrivateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

/** Derive the stable device ID from a base64 SPKI-DER public key.
 *  Deterministic: the same public key always yields the same device ID. */
export function deriveDeviceId(signingPublicKeyBase64: string): string {
  const der = Buffer.from(signingPublicKeyBase64, "base64");
  if (der.length === 0) throw new Error("empty public key");
  // Validate it really is an Ed25519 SPKI key before fingerprinting it, so a
  // malformed/foreign key can never masquerade as a well-formed device ID.
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`expected an ed25519 public key, got ${key.asymmetricKeyType}`);
  }
  return `did_${createHash("sha256").update(der).digest("hex")}`;
}

/** True for a well-formed device ID string. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_RE.test(value);
}

/** A short, human-comparable form of a device ID for UI display (never for
 *  equality — always compare the full device ID). E.g. `did_ab12…9f0c`. */
export function shortDeviceId(deviceId: string): string {
  if (!isDeviceId(deviceId)) return deviceId;
  const hex = deviceId.slice("did_".length);
  return `did_${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/** Verify a base64 PKCS8 private key belongs to the given base64 SPKI public key,
 *  by re-deriving the public key from the private key and comparing device IDs.
 *  Guards against a corrupted/mismatched keypair after decrypt. */
export function keypairMatches(keypair: InstanceSigningKeypair): boolean {
  try {
    const priv = createPrivateKey({
      key: Buffer.from(keypair.signingPrivateKey, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const derivedPub = createPublicKey(priv).export({ type: "spki", format: "der" }).toString("base64");
    return deriveDeviceId(derivedPub) === deriveDeviceId(keypair.signingPublicKey);
  } catch {
    return false;
  }
}

/** Sign a canonical protocol statement with this installation's Ed25519 key. */
export function signIdentityStatement(signingPrivateKey: string, statement: string): string {
  const privateKey = createPrivateKey({
    key: Buffer.from(signingPrivateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`expected an ed25519 private key, got ${privateKey.asymmetricKeyType}`);
  }
  return sign(null, Buffer.from(statement, "utf8"), privateKey).toString("base64");
}

/** Verify an Ed25519 protocol statement. Malformed peer material fails closed. */
export function verifyIdentityStatement(
  signingPublicKey: string,
  statement: string,
  signature: string,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(signingPublicKey, "base64"),
      format: "der",
      type: "spki",
    });
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    return verify(
      null,
      Buffer.from(statement, "utf8"),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
