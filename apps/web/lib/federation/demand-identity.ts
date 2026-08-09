import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/govern/credential-crypto";

import {
  deriveDeviceId,
  generateInstanceSigningKeypair,
  isDeviceId,
  keypairMatches,
} from "./instance-identity";

const FEDERATION_IDENTITY_KEY = "federation.identity";

export interface FederationIdentity {
  installationId: string;
  projectionSecret: string;
  /** Stable cryptographic device ID (fingerprint of the signing public key).
   *  Present once the install has been upgraded to carry a keypair (increment 1);
   *  optional so pre-keypair callers/fixtures keep compiling. */
  deviceId?: string;
  /** Ed25519 signing public key (SPKI DER, base64). Safe to publish to peers. */
  signingPublicKey?: string;
}

export interface FederationSigningIdentity extends FederationIdentity {
  deviceId: string;
  signingPublicKey: string;
  /** Decrypted only for the duration of a signing operation; never persist or return to UI. */
  signingPrivateKey: string;
}

export interface FederationIdentityDb {
  platformConfig: {
    upsert(args: unknown): Promise<{ value: unknown }>;
    // Used only to upgrade a legacy identity in place with a keypair.
    update(args: unknown): Promise<{ value: unknown }>;
  };
}

// The stored blob is a superset of FederationIdentity: it also holds the ENCRYPTED
// private key, which is never returned in the in-memory FederationIdentity (a later
// signing/SAS increment adds a guarded decrypt accessor).
interface StoredFederationIdentity extends FederationIdentity {
  signingPrivateKeyEnc?: string;
}

function decodeIdentity(value: unknown): StoredFederationIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoredFederationIdentity>;
  if (!/^inst_[a-f0-9]{32}$/.test(candidate.installationId ?? "")) return null;
  if (!/^[a-f0-9]{64}$/.test(candidate.projectionSecret ?? "")) return null;
  return candidate as StoredFederationIdentity;
}

/** True once the stored identity carries a complete, well-formed signing keypair. */
function hasKeypair(stored: StoredFederationIdentity): boolean {
  return (
    isDeviceId(stored.deviceId) &&
    typeof stored.signingPublicKey === "string" &&
    stored.signingPublicKey.length > 0 &&
    typeof stored.signingPrivateKeyEnc === "string" &&
    stored.signingPrivateKeyEnc.length > 0
  );
}

function keypairFields(): Pick<StoredFederationIdentity, "deviceId" | "signingPublicKey" | "signingPrivateKeyEnc"> {
  const kp = generateInstanceSigningKeypair();
  return {
    deviceId: deriveDeviceId(kp.signingPublicKey),
    signingPublicKey: kp.signingPublicKey,
    signingPrivateKeyEnc: encryptSecret(kp.signingPrivateKey),
  };
}

function generateIdentity(): StoredFederationIdentity {
  return {
    installationId: `inst_${randomUUID().replaceAll("-", "")}`,
    projectionSecret: randomBytes(32).toString("hex"),
    ...keypairFields(),
  };
}

function toPublicIdentity(stored: StoredFederationIdentity): FederationIdentity {
  return {
    installationId: stored.installationId,
    projectionSecret: stored.projectionSecret,
    ...(stored.deviceId ? { deviceId: stored.deviceId } : {}),
    ...(stored.signingPublicKey ? { signingPublicKey: stored.signingPublicKey } : {}),
  };
}

/** Resolve stable, local-only identity material without relying on hostnames.
 *  A pre-increment-1 identity (no keypair) is upgraded in place on first read,
 *  so every install gains a device ID exactly once with no operator action. */
async function resolveStoredFederationIdentity(db: FederationIdentityDb): Promise<StoredFederationIdentity> {
  const generated = generateIdentity();
  const row = await db.platformConfig.upsert({
    where: { key: FEDERATION_IDENTITY_KEY },
    create: { key: FEDERATION_IDENTITY_KEY, value: generated },
    update: {},
    select: { value: true },
  });
  const stored = decodeIdentity(row.value);
  if (!stored) throw new Error("Stored federation identity is invalid and requires operator repair.");
  if (hasKeypair(stored)) return stored;

  // Legacy identity created before increment 1 — mint and persist a keypair once.
  const upgraded: StoredFederationIdentity = { ...stored, ...keypairFields() };
  const updated = await db.platformConfig.update({
    where: { key: FEDERATION_IDENTITY_KEY },
    data: { value: upgraded },
    select: { value: true },
  });
  return decodeIdentity(updated.value) ?? upgraded;
}

export async function resolveFederationIdentity(db: FederationIdentityDb): Promise<FederationIdentity> {
  return toPublicIdentity(await resolveStoredFederationIdentity(db));
}

/** Resolve and validate private identity material for a bounded signing operation. */
export async function resolveFederationSigningIdentity(
  db: FederationIdentityDb,
  options: { decryptSecret?: (value: string) => string | null } = {},
): Promise<FederationSigningIdentity> {
  const stored = await resolveStoredFederationIdentity(db);
  if (!hasKeypair(stored)) {
    throw new Error("Stored federation identity has no signing keypair.");
  }
  const signingPrivateKey = (options.decryptSecret ?? decryptSecret)(stored.signingPrivateKeyEnc!);
  if (!signingPrivateKey) {
    throw new Error("Stored federation identity signing key could not be decrypted.");
  }
  const keypair = { signingPublicKey: stored.signingPublicKey!, signingPrivateKey };
  if (
    !keypairMatches(keypair) ||
    deriveDeviceId(stored.signingPublicKey!) !== stored.deviceId
  ) {
    throw new Error("Stored federation identity signing key does not match its public identity.");
  }
  return {
    ...toPublicIdentity(stored),
    deviceId: stored.deviceId!,
    signingPublicKey: stored.signingPublicKey!,
    signingPrivateKey,
  };
}

function opaqueRef(secret: string, purpose: string, localRecordRef: string): string {
  return createHmac("sha256", secret)
    .update(`${purpose}\u0000${localRecordRef}`)
    .digest("hex")
    .slice(0, 32);
}

/** Stable cross-link references that cannot be reversed to a local BI identifier. */
export function deriveDemandNetworkRefs(
  identity: FederationIdentity,
  localRecordRef: string,
): { envelopeId: string; originRecordRef: string } {
  return {
    envelopeId: `dem_${opaqueRef(identity.projectionSecret, "envelope", localRecordRef)}`,
    originRecordRef: `ref_${opaqueRef(identity.projectionSecret, "origin", localRecordRef)}`,
  };
}
