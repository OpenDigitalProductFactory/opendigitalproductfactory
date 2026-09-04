import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/govern/credential-crypto";

import {
  defaultFederationStore,
  type DurableFederationIdentityV1,
  type DurableFederationStore,
} from "./durable-state";
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

export interface FederationIdentityOptions {
  /** Durable (state-directory) store; defaults to the file-backed store. */
  store?: DurableFederationStore;
  decryptSecret?: (value: string) => string | null;
}

/**
 * Resolve identity with the durable file as the source of truth (EP-ZERO-CONFIG-
 * FEDERATION §5.1). The file wins: when the state directory carries an identity
 * the database row is corrected to match, so a rebuilt database never overrides
 * the identity a peer already trusts. Without a file, the database identity is
 * used as before and then written to the file so the NEXT reinstall keeps it.
 */
async function resolveStoredFederationIdentity(
  db: FederationIdentityDb,
  options: FederationIdentityOptions = {},
): Promise<StoredFederationIdentity> {
  const store = options.store ?? defaultFederationStore();
  const decrypt = options.decryptSecret ?? decryptSecret;

  let durable: DurableFederationIdentityV1 | null = null;
  try {
    durable = await store.readIdentity();
  } catch {
    durable = null;
  }
  if (durable) {
    const desired: StoredFederationIdentity = {
      installationId: durable.installationId,
      projectionSecret: durable.projectionSecret,
      deviceId: durable.deviceId,
      signingPublicKey: durable.signingPublicKey,
      signingPrivateKeyEnc: encryptSecret(durable.signingPrivateKey),
    };
    const row = await db.platformConfig.upsert({
      where: { key: FEDERATION_IDENTITY_KEY },
      create: { key: FEDERATION_IDENTITY_KEY, value: desired },
      update: {},
      select: { value: true },
    });
    const stored = decodeIdentity(row.value);
    const matches = !!stored
      && stored.installationId === desired.installationId
      && stored.projectionSecret === desired.projectionSecret
      && stored.deviceId === desired.deviceId
      && stored.signingPublicKey === desired.signingPublicKey
      && (stored.signingPrivateKeyEnc ? decrypt(stored.signingPrivateKeyEnc) : null) === durable.signingPrivateKey;
    if (!matches) {
      await db.platformConfig.update({
        where: { key: FEDERATION_IDENTITY_KEY },
        data: { value: desired },
        select: { value: true },
      });
    }
    return desired;
  }

  const stored = await resolveDatabaseFederationIdentity(db);
  // Persist for the next reinstall when the private key is usable. A read never
  // changes the keypair: an undecryptable key is repaired only by the explicit
  // boot reconcile (persistFederationIdentityDurably), so a transient decrypt
  // failure on a request path can never change the device id peers know.
  let signingPrivateKey: string | null = null;
  try {
    signingPrivateKey = stored.signingPrivateKeyEnc ? decrypt(stored.signingPrivateKeyEnc) : null;
  } catch {
    signingPrivateKey = null;
  }
  if (signingPrivateKey && keypairMatches({ signingPublicKey: stored.signingPublicKey!, signingPrivateKey })) {
    try {
      await store.writeIdentity(toDurable(stored, signingPrivateKey));
    } catch {
      // Unwritable state directory: the install keeps working on its database identity.
    }
  }
  return stored;
}

function toDurable(stored: StoredFederationIdentity, signingPrivateKey: string): DurableFederationIdentityV1 {
  return {
    schemaVersion: 1,
    installationId: stored.installationId,
    projectionSecret: stored.projectionSecret,
    deviceId: stored.deviceId!,
    signingPublicKey: stored.signingPublicKey!,
    signingPrivateKey,
    writtenAt: new Date().toISOString(),
  };
}

/**
 * Boot-time persistence (EP-ZERO-CONFIG-FEDERATION 5.1 step 2). Resolves the
 * identity; when the database's private key cannot be decrypted (rotated
 * CREDENTIAL_ENCRYPTION_KEY) it keeps `installationId` and `projectionSecret` -
 * the facts peers hold - and mints a fresh signing keypair, persisting both the
 * database row and the durable file. Returns how the identity is now held.
 */
export async function persistFederationIdentityDurably(
  db: FederationIdentityDb,
  options: FederationIdentityOptions = {},
): Promise<"durable" | "database-only"> {
  const store = options.store ?? defaultFederationStore();
  const decrypt = options.decryptSecret ?? decryptSecret;
  const stored = await resolveStoredFederationIdentity(db, options);
  if (await store.readIdentity()) return "durable";
  let signingPrivateKey: string | null;
  try {
    signingPrivateKey = stored.signingPrivateKeyEnc ? decrypt(stored.signingPrivateKeyEnc) : null;
  } catch {
    return "database-only";
  }
  let effective = stored;
  if (!signingPrivateKey || !keypairMatches({ signingPublicKey: stored.signingPublicKey!, signingPrivateKey })) {
    const kp = generateInstanceSigningKeypair();
    signingPrivateKey = kp.signingPrivateKey;
    effective = {
      ...stored,
      deviceId: deriveDeviceId(kp.signingPublicKey),
      signingPublicKey: kp.signingPublicKey,
      signingPrivateKeyEnc: encryptSecret(kp.signingPrivateKey),
    };
    await db.platformConfig.update({
      where: { key: FEDERATION_IDENTITY_KEY },
      data: { value: effective },
      select: { value: true },
    });
  }
  const written = await store.writeIdentity(toDurable(effective, signingPrivateKey)).catch(() => false);
  return written ? "durable" : "database-only";
}

/** Whether this installation's identity is held in the teardown-surviving state directory. */
export async function isFederationIdentityDurable(store: DurableFederationStore = defaultFederationStore()): Promise<boolean> {
  try {
    return (await store.readIdentity()) !== null;
  } catch {
    return false;
  }
}

/** Database-only resolution (the pre-durable behaviour), kept as the fallback.
 *  A pre-increment-1 identity (no keypair) is upgraded in place on first read,
 *  so every install gains a device ID exactly once with no operator action. */
async function resolveDatabaseFederationIdentity(db: FederationIdentityDb): Promise<StoredFederationIdentity> {
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

export async function resolveFederationIdentity(
  db: FederationIdentityDb,
  options: FederationIdentityOptions = {},
): Promise<FederationIdentity> {
  return toPublicIdentity(await resolveStoredFederationIdentity(db, options));
}

/** Resolve and validate private identity material for a bounded signing operation. */
export async function resolveFederationSigningIdentity(
  db: FederationIdentityDb,
  options: FederationIdentityOptions = {},
): Promise<FederationSigningIdentity> {
  const stored = await resolveStoredFederationIdentity(db, options);
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
