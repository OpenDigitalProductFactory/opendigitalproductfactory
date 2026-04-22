// apps/web/lib/credential-crypto.ts
// AES-256-GCM encryption for credential secrets at rest.
// Requires CREDENTIAL_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
// Plain-text legacy values (not prefixed with "enc:") are handled gracefully on read.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer | null {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

let _warnedMissingKey = false;

/** Encrypt a secret. Returns `enc:<iv>:<tag>:<ciphertext>` (all base64).
 *  If no encryption key is configured, returns plaintext (dev-mode fallback). */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (!_warnedMissingKey) {
      console.warn(
        "WARNING: CREDENTIAL_ENCRYPTION_KEY not set — credentials will be stored in plaintext. " +
          "Set this variable for production deployments."
      );
      _warnedMissingKey = true;
    }
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/** Decrypt a stored secret. Handles both encrypted (`enc:…`) and legacy plaintext values.
 *  Returns `null` when decryption fails (e.g. encryption key was rotated). */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith("enc:")) return stored; // legacy plain text

  const key = getEncryptionKey();
  if (!key) throw new Error("CREDENTIAL_ENCRYPTION_KEY required to decrypt stored credentials");

  const parts = stored.split(":");
  if (parts.length !== 4) return null; // malformed

  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const ciphertext = Buffer.from(parts[3]!, "base64");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
  } catch {
    // AES-GCM auth failure — encryption key was rotated since this credential was stored.
    console.warn("[credential-crypto] Cannot decrypt credential — encryption key may have changed. Re-configure the provider.");
    return null;
  }
}

/** Encrypt a structured value by JSON-stringifying it first. Shape-agnostic — use for polymorphic
 *  integration credential blobs where the fields vary by provider. */
export function encryptJson<T>(value: T): string {
  return encryptSecret(JSON.stringify(value));
}

/** Decrypt a JSON-encoded blob. Returns null on decryption failure OR JSON parse failure. */
export function decryptJson<T>(stored: string): T | null {
  const raw = decryptSecret(stored);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
