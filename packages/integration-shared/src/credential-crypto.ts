import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer | null {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

let warnedMissingKey = false;

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (!warnedMissingKey) {
      console.warn(
        "[integration-shared:credential-crypto] CREDENTIAL_ENCRYPTION_KEY not set — credentials will be stored in plaintext.",
      );
      warnedMissingKey = true;
    }
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith("enc:")) return stored;

  const key = getEncryptionKey();
  if (!key) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY required to decrypt stored credentials");
  }

  const parts = stored.split(":");
  if (parts.length !== 4) return null;

  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const ciphertext = Buffer.from(parts[3]!, "base64");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
  } catch {
    console.warn(
      "[integration-shared:credential-crypto] Cannot decrypt credential — encryption key may have changed. Re-configure the integration.",
    );
    return null;
  }
}

export function encryptJson<T>(value: T): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(stored: string): T | null {
  const raw = decryptSecret(stored);
  if (raw === null) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
