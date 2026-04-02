import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (storedHash.startsWith("$2")) {
    const valid = await bcrypt.compare(password, storedHash);
    return { valid, needsRehash: false };
  }
  if (storedHash.length === 64 && /^[0-9a-f]+$/.test(storedHash)) {
    const data = new TextEncoder().encode(password);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    const sha256 = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const valid = sha256 === storedHash;
    return { valid, needsRehash: valid };
  }
  return { valid: false, needsRehash: false };
}
