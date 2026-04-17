// packages/db/scripts/credential-health-check.ts
//
// Startup credential health check.  Detects credentials that can no longer be
// decrypted (key rotation: .env deleted or CREDENTIAL_ENCRYPTION_KEY changed
// while DB volumes persisted) and marks them as "key_rotated" so:
//
//   - the admin preflight check flags them with a clear fix
//   - the admin UI can show a banner asking for re-authentication
//   - the routing pipeline can skip them without opaque 401 errors
//
// See PROVIDER-ACTIVATION-AUDIT.md F-15, F-16.
//
// Intentionally self-contained — replicates the AES-GCM decryption shape from
// apps/web/lib/govern/credential-crypto.ts so this script can run from
// packages/db without a cross-package import at container startup.

import { createDecipheriv } from "crypto";
import { prisma } from "../src/client";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer | null {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

/**
 * Test whether a stored "enc:*" value can be decrypted with the current key.
 * Returns true if decryption succeeds, false on auth failure (key mismatch).
 * Plaintext values (no "enc:" prefix) always return true.
 */
export function canDecrypt(stored: string, key: Buffer): boolean {
  if (!stored.startsWith("enc:")) return true; // legacy plaintext
  const parts = stored.split(":");
  if (parts.length !== 4) return false; // malformed

  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const ciphertext = Buffer.from(parts[3]!, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    decipher.update(ciphertext, undefined, "utf8");
    decipher.final("utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify a single credential row as key-rotated (undecryptable) or healthy.
 * A row is key-rotated when it has at least one "enc:" field AND every "enc:"
 * field fails to decrypt with the supplied key.
 */
export function isKeyRotated(
  cred: {
    secretRef: string | null;
    clientSecret: string | null;
    cachedToken: string | null;
    refreshToken: string | null;
  },
  key: Buffer,
): boolean {
  const fields = [cred.secretRef, cred.clientSecret, cred.cachedToken, cred.refreshToken];
  const encryptedFields = fields.filter(
    (v): v is string => typeof v === "string" && v.startsWith("enc:"),
  );
  if (encryptedFields.length === 0) return false; // no encrypted values — nothing to rotate
  return !encryptedFields.some((v) => canDecrypt(v, key));
}

async function main(): Promise<void> {
  const key = getEncryptionKey();
  if (!key) {
    console.log(
      "  -- CREDENTIAL_ENCRYPTION_KEY not set (dev mode) — skipping credential health check",
    );
    return;
  }

  // Only check credentials that (a) have at least one encrypted value, and
  // (b) aren't already flagged as unconfigured/key_rotated (idempotent re-run).
  const credentials = await prisma.credentialEntry.findMany({
    where: {
      status: { notIn: ["unconfigured", "key_rotated"] },
      OR: [
        { secretRef: { startsWith: "enc:" } },
        { cachedToken: { startsWith: "enc:" } },
        { refreshToken: { startsWith: "enc:" } },
        { clientSecret: { startsWith: "enc:" } },
      ],
    },
    select: {
      providerId: true,
      status: true,
      secretRef: true,
      clientSecret: true,
      cachedToken: true,
      refreshToken: true,
    },
  });

  if (credentials.length === 0) {
    console.log("  OK No encrypted credentials to verify");
    return;
  }

  const rotated: string[] = [];
  const healthy: string[] = [];

  for (const cred of credentials) {
    if (isKeyRotated(cred, key)) {
      rotated.push(cred.providerId);
    } else {
      healthy.push(cred.providerId);
    }
  }

  if (rotated.length > 0) {
    await prisma.credentialEntry.updateMany({
      where: { providerId: { in: rotated } },
      data: { status: "key_rotated" },
    });
    console.warn(
      `  WARN ${rotated.length} credential(s) undecryptable — encryption key changed since storage. Marked key_rotated: ${rotated.join(", ")}`,
    );
    console.warn(
      "       Admin action required: re-enter API key or re-authorize OAuth for each affected provider.",
    );
  }

  console.log(
    `  OK Credential health: ${healthy.length} healthy, ${rotated.length} key_rotated (of ${credentials.length} encrypted)`,
  );
}

// Only execute as a script, not on import (so tests can import without running).
// process.argv[1] contains the script path when run via `tsx scripts/credential-health-check.ts`.
const invokedPath = process.argv[1] ?? "";
if (invokedPath.endsWith("credential-health-check.ts") || invokedPath.endsWith("credential-health-check.js")) {
  main()
    .catch((err) => {
      console.error("[credential-health-check] Failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
